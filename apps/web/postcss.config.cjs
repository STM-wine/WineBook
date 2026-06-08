module.exports = {
  plugins: [
    "./postcss-ag-grid-flex-end.cjs",
    "next/dist/compiled/postcss-flexbugs-fixes",
    [
      "next/dist/compiled/postcss-preset-env",
      {
        autoprefixer: {
          flexbox: "no-2009"
        },
        features: {
          "custom-properties": false
        },
        stage: 3
      }
    ]
  ]
};
