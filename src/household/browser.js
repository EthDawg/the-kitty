/* The bundle's entry. Everything a page needs is inside: the schema, the law, the recipes, the dictionary. */
"use strict";
const K = require("./index");
K.setBase({ recipes: require("kitty:recipes"), merchants: require("../../merchants/merchants.json"), categories: require("../../merchants/categories.json") });
module.exports = K;
