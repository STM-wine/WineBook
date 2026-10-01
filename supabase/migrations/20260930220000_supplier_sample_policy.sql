-- Keep Michelle's two supplier identities separate and encode the two default sample arrangements.
alter table public.suppliers
    add column if not exists qb_vendor_name text,
    add column if not exists importer_winery_name text,
    add column if not exists sample_allowance_type text,
    add column if not exists sample_allowance_rate numeric(5, 4),
    add column if not exists current_da_in_place boolean;

alter table public.suppliers
    add constraint suppliers_sample_allowance_type_check
        check (sample_allowance_type is null or sample_allowance_type in ('billback', 'invoice_discount', 'none')),
    add constraint suppliers_sample_allowance_rate_check
        check (sample_allowance_rate is null or sample_allowance_rate between 0 and 1);

grant update (
    qb_vendor_name,
    importer_winery_name,
    sample_allowance_type,
    sample_allowance_rate,
    current_da_in_place,
    updated_at
)
    on public.suppliers
    to authenticated;

do $migration$
declare
    updated_count integer;
begin
    with source_data (supplier_name, qb_vendor_name, importer_winery_name, sample_allowance_type, sample_allowance_rate, current_da_in_place) as (
      values
      ('Ad Ripa Wines', 'Ad Ripa Wines', 'Ad Ripa', 'billback', 0.5, TRUE),
      ('Allura Wine', 'USA Wine West - Allura Wine', 'Allura Wine', 'invoice_discount', 0.02, TRUE),
      ('Altos Las Hormigas', 'USA Wine West - Altos Las Hormigas', 'Altos Las Hormigas', 'billback', 0.5, TRUE),
      ('Andrew Will Wines', 'Andrew Will Winery', 'Andrew Will Wines', 'billback', 0.5, TRUE),
      ('Ant Moore', 'USA Wine West - Antmoore', 'Ant Moore', 'billback', 0.5, TRUE),
      ('Antica Terra', 'Makk Wine', 'Antica Terra', 'billback', 0.5, NULL),
      ('Aperture Cellars', 'Aperture Cellars', 'Aperture Cellars', 'billback', 0.5, TRUE),
      ('Arietta', 'Arietta Inc', 'Arietta', 'invoice_discount', 0.02, NULL),
      ('Barnard Griffin', 'Barnard Griffin', 'Barnard Griffin', 'billback', 0.5, TRUE),
      ('Bolle', 'Bolle Drinks Corporation', 'Bolle', 'invoice_discount', 0.02, NULL),
      ('Brazos Imports', 'Brazos Imports', 'Brazos Imports', 'invoice_discount', 0.02, NULL),
      ('Broadbent Selections', 'Broadbent Selections', 'Broadbent Selections', 'billback', 0.5, TRUE),
      ('Chosen Family Wines', 'Chosen Family Wines', 'Chosen Family Wines', 'billback', 0.5, TRUE),
      ('Ian Brand', 'Chualar Canyon Winery', 'Ian Brand', 'invoice_discount', 0.02, NULL),
      ('Corison', 'Corison Winery Inc', 'Corison', 'invoice_discount', 0.01, NULL),
      ('Dunn', 'Dunn Vineyards', 'Dunn', 'billback', 0.5, NULL),
      ('Emerson Brown Wines', 'Emerson Brown Wines LLC', 'Emerson Brown Wines', 'billback', 0.5, TRUE),
      ('Enos Vineyards', 'Enos Vineyards, Inc.', 'Enos Vineyards', 'invoice_discount', 0.01, NULL),
      ('Fayard Wines', 'Fayard Wines', 'Fayard Wines', 'invoice_discount', 0.02, NULL),
      ('Frog''s Leap', 'VINTUS LLC', 'Frog''s Leap', 'billback', 0.5, TRUE),
      ('German Wine Collection', 'German Wine Collection', 'German Wine Collection', 'billback', 0.5, TRUE),
      ('Giuliana Imports', 'Giuliana Imports', 'Giuliana, Giuliana Imports', 'invoice_discount', 0.02, TRUE),
      ('Grand Cru Selections', 'Grand Cru Selections', 'Grand Cru Selections', 'billback', 0.5, NULL),
      ('Hirsch Vineyards', 'Hirsch Winery, LLC', 'Hirsch', 'billback', 0.5, NULL),
      ('Illahe', 'Illahe Vineyards and Winery', 'Illahe', 'invoice_discount', 0.02, TRUE),
      ('Jack Edwards Collection', 'Jack Edwards Collection', 'Jack Edwards Collection', 'billback', 0.5, NULL),
      ('JL Chave', 'MHW Ltd - Chave Export Consulting', 'JL Chave', 'none', NULL, NULL),
      ('Jolie-Laide', 'Jolie-Laide', 'Jolie-Laide', 'invoice_discount', 0.02, TRUE),
      ('Latta Wines', 'Latta Wines', 'Latta', 'billback', 0.5, NULL),
      ('Kinsman Wine', 'Kinsman Wine', 'Kinsman, Kinsman Wine', 'billback', 0.5, NULL),
      ('Legend Imports', 'USA Wine West - Legend Imports', 'Legend Imports', 'billback', 0.5, NULL),
      ('Lieu Dit Winery', 'Lieu Dit Winery', 'Lieu Dit Winery', 'billback', 0.5, TRUE),
      ('LIOCO', 'LIOCO Wine Company', 'LIOCO', 'billback', 0.5, TRUE),
      ('Los Milics', 'Los Milics Vineyards', 'Los Milics', 'billback', 0.5, TRUE),
      ('Mallea Wine Co', 'Mallea Wine Co', 'Mallea', 'billback', 0.5, NULL),
      ('Martine''s Wines', 'Martine''s Wines', 'Martine''s Wines', 'billback', 0.5, NULL),
      ('Matthiasson', 'Matthiasson Family Vyds, LLC', 'Matthiasson', 'invoice_discount', 0.02, NULL),
      ('Mayacamas', 'Mayacamas Vineyards', 'Mayacamas', 'billback', 0.5, TRUE),
      ('Montinore', 'Montinore Vineyards Limited', 'Montinore', 'billback', 0.5, TRUE),
      ('Mount Eden', 'Mount Eden Vineyards', 'Mount Eden', 'billback', 0.5, NULL),
      ('IBG', 'Nexus Brands LLC', 'IBG', 'billback', 0.5, TRUE),
      ('Nicolas-Jay', 'Nicolas-Jay', 'Nicolas-Jay', 'invoice_discount', 0.02, TRUE),
      ('North Berkeley', 'North Berkeley Imports', 'North Berkeley', 'billback', 0.5, TRUE),
      ('Northwest Wine Co.', 'Northwest Wine Co.', 'Northwest Wine Co.', 'billback', 0.5, NULL),
      ('Occidental', 'Occidental', 'Occidental', 'billback', 0.5, TRUE),
      ('Rajat Parr', 'Parr Wines LLC', 'Rajat Parr', 'billback', 0.5, NULL),
      ('Paydirt', 'Land of Riches', 'Paydirt', 'billback', 0.5, TRUE),
      ('Pisoni Family', 'Sons of Bacchus', 'Pisoni Family', 'billback', 0.5, NULL),
      ('Rose & Arrow', 'Rose & Arrow, LLC', 'Rose & Arrow', 'billback', 0.5, TRUE),
      ('Rune', 'Rune Wines', 'Rune', 'billback', 0.5, NULL),
      ('Scale', 'Scale Wine Group LLC', 'Scale', 'billback', 0.5, TRUE),
      ('Scar of the Sea', 'Scar of the Sea Wines', 'Scar of the Sea', 'invoice_discount', 0.02, NULL),
      ('Stolpman', 'Stolpman Vineyards', 'Stolpman', 'billback', 0.5, TRUE),
      ('Susurrus', 'Susurrus Teas', 'Susurrus', 'billback', 0.5, TRUE),
      ('Tatomer', 'Tatomer, Inc.', 'Tatomer', 'invoice_discount', 0.02, TRUE),
      ('Truchard Vineyards', 'Truchard Vineyards', 'Truchard Vineyards', 'billback', 0.5, TRUE),
      ('True North', 'True North Wine Merchants', 'True North', 'billback', 0.5, NULL),
      ('Twins', 'Fruit of the Vines - TWINS', 'Twins', 'none', NULL, NULL),
      ('Tyler', 'J Willett Companies', 'Tyler', 'billback', 0.5, TRUE),
      ('Ultraviolet/Poe Wines', 'Ultraviolet/Poe Wines', 'Ultraviolet/Poe Wines', 'invoice_discount', 0.03, NULL),
      ('Valkyrie Selections', 'Valkyrie Selections', 'Valkyrie Selections', 'invoice_discount', 0.02, TRUE),
      ('Vinity Wine Company', 'Vinity Wine Company, Inc.', 'Vinity Wine Company', 'billback', 0.5, TRUE),
      ('Walter Scott', 'OKP LLC', 'Walter Scott', 'invoice_discount', 0.02, NULL),
      ('Zepeim', 'Zepeim', 'Copenhagen', 'none', NULL, NULL)
    )
    update public.suppliers as supplier
       set qb_vendor_name = source_data.qb_vendor_name,
           importer_winery_name = source_data.importer_winery_name,
           sample_allowance_type = source_data.sample_allowance_type,
           sample_allowance_rate = source_data.sample_allowance_rate,
           current_da_in_place = source_data.current_da_in_place,
           updated_at = now()
      from source_data
     where supplier.name = source_data.supplier_name
       and coalesce(supplier.active, true);

    get diagnostics updated_count = row_count;
    if updated_count <> 64 then
        raise exception 'Expected to update 64 active supplier rows from Michelle sample list; updated %', updated_count;
    end if;
end;
$migration$;

notify pgrst, 'reload schema';
