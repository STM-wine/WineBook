const path = require("path");

module.exports = {
  postcssPlugin: "postcss-ag-grid-flex-end",
  Declaration(decl) {
    const file = decl.source?.input.file || "";
    const isAgGridCss = file.includes(`${path.sep}ag-grid-community${path.sep}`);

    if (isAgGridCss && decl.prop === "justify-content" && decl.value === "end") {
      decl.value = "flex-end";
    }
  }
};
