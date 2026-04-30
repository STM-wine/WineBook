"""Fetch daily Vinosmith report emails and persist a scheduled report run.

This script is designed for GitHub Actions, but it also runs locally when the
mailbox and Supabase environment variables are present.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from email import policy
from email.message import EmailMessage
from email.parser import BytesParser
from email.utils import parsedate_to_datetime
import argparse
import imaplib
import mimetypes
import os
from pathlib import Path
import re
import sys
import tempfile
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from stem_order.pipeline import build_ordering_pipeline
from stem_order.supabase_repository import SupabaseRepository, load_dotenv


DEFAULT_RB6_KEYWORDS = ["inventory", "velocity", "rb6"]
DEFAULT_RADS_KEYWORDS = ["rads", "sales", "vinosmith"]
DEFAULT_TIMEZONE = "America/Denver"
DEFAULT_BUCKET = "source-files"


@dataclass
class AttachmentCandidate:
    filename: str
    payload: bytes
    content_type: str | None
    message_id: str | None
    message_date: datetime | None


@dataclass
class ReportAttachments:
    rb6: Path
    rads: Path
    rb6_candidate: AttachmentCandidate
    rads_candidate: AttachmentCandidate


def csv_env(name: str, default: list[str]) -> list[str]:
    raw = os.getenv(name)
    if not raw:
        return default
    return [part.strip().lower() for part in raw.split(",") if part.strip()]


def normalized_filename(filename: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", filename.lower()).strip()


def score_filename(filename: str, keywords: list[str]) -> int:
    haystack = normalized_filename(filename)
    return sum(1 for keyword in keywords if keyword.lower() in haystack)


def classify_attachments(
    attachments: list[AttachmentCandidate],
    rb6_keywords: list[str] | None = None,
    rads_keywords: list[str] | None = None,
) -> tuple[AttachmentCandidate, AttachmentCandidate]:
    rb6_keywords = rb6_keywords or DEFAULT_RB6_KEYWORDS
    rads_keywords = rads_keywords or DEFAULT_RADS_KEYWORDS

    spreadsheet_attachments = [
        attachment
        for attachment in attachments
        if attachment.filename.lower().endswith((".xlsx", ".xls", ".csv"))
    ]
    if not spreadsheet_attachments:
        raise RuntimeError("No spreadsheet attachments found in matching Vinosmith emails.")

    rb6 = max(spreadsheet_attachments, key=lambda item: score_filename(item.filename, rb6_keywords))
    rads = max(spreadsheet_attachments, key=lambda item: score_filename(item.filename, rads_keywords))

    if score_filename(rb6.filename, rb6_keywords) == 0:
        raise RuntimeError(
            f"Could not identify inventory/RB6 report from attachments: "
            f"{[item.filename for item in spreadsheet_attachments]}"
        )
    if score_filename(rads.filename, rads_keywords) == 0:
        raise RuntimeError(
            f"Could not identify RADs/sales report from attachments: "
            f"{[item.filename for item in spreadsheet_attachments]}"
        )
    if rb6.filename == rads.filename and rb6.message_id == rads.message_id:
        raise RuntimeError(f"One attachment matched both report types: {rb6.filename}")

    return rb6, rads


def safe_filename(filename: str) -> str:
    cleaned = Path(filename).name
    return re.sub(r"[^A-Za-z0-9._ -]+", "_", cleaned)


def write_report_attachments(
    attachments: list[AttachmentCandidate],
    destination: Path,
    rb6_keywords: list[str] | None = None,
    rads_keywords: list[str] | None = None,
) -> ReportAttachments:
    rb6_candidate, rads_candidate = classify_attachments(attachments, rb6_keywords, rads_keywords)
    destination.mkdir(parents=True, exist_ok=True)

    rb6_path = destination / safe_filename(rb6_candidate.filename)
    rads_path = destination / safe_filename(rads_candidate.filename)
    rb6_path.write_bytes(rb6_candidate.payload)
    rads_path.write_bytes(rads_candidate.payload)

    return ReportAttachments(
        rb6=rb6_path,
        rads=rads_path,
        rb6_candidate=rb6_candidate,
        rads_candidate=rads_candidate,
    )


def attachment_candidates_from_message(message: EmailMessage) -> list[AttachmentCandidate]:
    candidates = []
    message_date = None
    if message.get("Date"):
        try:
            message_date = parsedate_to_datetime(message["Date"])
        except (TypeError, ValueError):
            message_date = None

    for part in message.walk():
        filename = part.get_filename()
        if not filename:
            continue
        payload = part.get_payload(decode=True)
        if payload is None:
            continue
        candidates.append(
            AttachmentCandidate(
                filename=filename,
                payload=payload,
                content_type=part.get_content_type(),
                message_id=message.get("Message-ID"),
                message_date=message_date,
            )
        )
    return candidates


def imap_date(value: date) -> str:
    return value.strftime("%d-%b-%Y")


def fetch_vinosmith_attachments(
    report_date: date,
    host: str,
    username: str,
    password: str,
    mailbox: str = "INBOX",
    port: int = 993,
    sender: str | None = None,
    subject_keyword: str | None = None,
) -> list[AttachmentCandidate]:
    search_parts = ["SINCE", imap_date(report_date)]
    if sender:
        search_parts.extend(["FROM", f'"{sender}"'])
    if subject_keyword:
        search_parts.extend(["SUBJECT", f'"{subject_keyword}"'])

    with imaplib.IMAP4_SSL(host, port) as imap:
        imap.login(username, password)
        imap.select(mailbox)
        status, data = imap.search(None, *search_parts)
        if status != "OK":
            raise RuntimeError(f"IMAP search failed with status {status}")

        attachments: list[AttachmentCandidate] = []
        for message_num in data[0].split():
            status, message_data = imap.fetch(message_num, "(RFC822)")
            if status != "OK":
                continue
            raw_message = message_data[0][1]
            message = BytesParser(policy=policy.default).parsebytes(raw_message)
            attachments.extend(attachment_candidates_from_message(message))
        return attachments


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report-date", help="Report date in YYYY-MM-DD. Defaults to today in America/Denver.")
    parser.add_argument("--force", action="store_true", help="Process even if a completed scheduled run exists.")
    parser.add_argument("--dry-run", action="store_true", help="Fetch and classify attachments without saving to Supabase.")
    return parser.parse_args()


def env_required(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def storage_path(report_date: date, source_type: str, filename: str) -> str:
    return f"vinosmith/{report_date.isoformat()}/{source_type}/{safe_filename(filename)}"


def main() -> None:
    load_dotenv()
    args = parse_args()
    timezone = ZoneInfo(os.getenv("REPORT_TIMEZONE", DEFAULT_TIMEZONE))
    report_date = (
        date.fromisoformat(args.report_date)
        if args.report_date
        else datetime.now(timezone).date()
    )

    host = env_required("EMAIL_HOST")
    username = env_required("EMAIL_USERNAME")
    password = env_required("EMAIL_PASSWORD")
    mailbox = os.getenv("EMAIL_MAILBOX") or "INBOX"
    port = int(os.getenv("EMAIL_PORT") or "993")
    sender = os.getenv("VINOSMITH_SENDER") or None
    subject_keyword = os.getenv("VINOSMITH_SUBJECT_KEYWORD") or None
    bucket = os.getenv("SUPABASE_SOURCE_BUCKET", DEFAULT_BUCKET)

    rb6_keywords = csv_env("RB6_ATTACHMENT_KEYWORDS", DEFAULT_RB6_KEYWORDS)
    rads_keywords = csv_env("RADS_ATTACHMENT_KEYWORDS", DEFAULT_RADS_KEYWORDS)

    repo = SupabaseRepository.from_env()
    if not args.force and repo.completed_report_run_exists("scheduled_email", report_date):
        print(f"Completed scheduled_email report already exists for {report_date}; skipping.")
        return

    attachments = fetch_vinosmith_attachments(
        report_date=report_date,
        host=host,
        username=username,
        password=password,
        mailbox=mailbox,
        port=port,
        sender=sender,
        subject_keyword=subject_keyword,
    )

    with tempfile.TemporaryDirectory() as tmpdir:
        reports = write_report_attachments(
            attachments,
            Path(tmpdir),
            rb6_keywords=rb6_keywords,
            rads_keywords=rads_keywords,
        )

        if args.dry_run:
            print(f"Found RB6 report: {reports.rb6.name}")
            print(f"Found RADs report: {reports.rads.name}")
            return

        rb6_source = repo.store_source_file(
            reports.rb6,
            source_type="rb6_inventory",
            bucket=bucket,
            storage_path=storage_path(report_date, "rb6_inventory", reports.rb6.name),
            content_type=reports.rb6_candidate.content_type or mimetypes.guess_type(reports.rb6.name)[0],
            metadata={"report_date": report_date.isoformat(), "source": "scheduled_email"},
            email_message_id=reports.rb6_candidate.message_id,
        )
        rads_source = repo.store_source_file(
            reports.rads,
            source_type="rads_sales",
            bucket=bucket,
            storage_path=storage_path(report_date, "rads_sales", reports.rads.name),
            content_type=reports.rads_candidate.content_type or mimetypes.guess_type(reports.rads.name)[0],
            metadata={"report_date": report_date.isoformat(), "source": "scheduled_email"},
            email_message_id=reports.rads_candidate.message_id,
        )

        result = build_ordering_pipeline(reports.rb6, reports.rads, ROOT / "importers.csv")
        report_run = repo.create_report_run(
            run_type="scheduled_email",
            source_file_ids=[rb6_source["id"], rads_source["id"]],
            report_date=report_date,
            source_channel="email",
            diagnostics={
                **result.diagnostics,
                "rb6_file_name": reports.rb6.name,
                "rads_file_name": reports.rads.name,
                "email_message_ids": [
                    reports.rb6_candidate.message_id,
                    reports.rads_candidate.message_id,
                ],
            },
        )

        try:
            saved = repo.save_recommendations(report_run["id"], result.recommendations)
            repo.complete_report_run(report_run["id"], diagnostics=result.diagnostics)
        except Exception as exc:
            repo.fail_report_run(report_run["id"], str(exc))
            raise

        print(f"report_run_id: {report_run['id']}")
        print(f"report_date: {report_date}")
        print(f"source_files: {rb6_source['id']}, {rads_source['id']}")
        print(f"recommendations_built: {len(result.recommendations)}")
        print(f"recommendations_saved: {len(saved)}")
        print(f"urgent_skus: {result.diagnostics['urgent_skus']}")
        print(f"recommended_bottles: {result.diagnostics['recommended_bottles']}")
        print(f"estimated_order_cost: ${result.diagnostics['estimated_order_cost']:,.2f}")


if __name__ == "__main__":
    main()
