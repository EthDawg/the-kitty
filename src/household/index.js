/* The household runtime: the verbs a household performs, one core for the page, the phone and an agent. It calls the standard's engine and never
   reimplements it. Pure JavaScript: anything a host owns, the disk, the connector, the clock, is injected. Node: require ./node. A page: the bundle. */
"use strict";
const { init } = require("./init");
const { add, addRecipe, bytesState, readState, sampleOf } = require("./add");
const { sha256 } = require("../../standard/intake/sha256");
const { rebuildAt, loadOriginals } = require("./clock");
const { status, readiness, DOMAINS } = require("./status");
const { next, pick } = require("./next");
const { decide } = require("./decide");
const { close } = require("./close");
const { record, replayWorld, treeHash, tableHashes } = require("./replay");
const { folderStore } = require("./store/folder");
const { googleStore, createSpreadsheet, NEEDS } = require("./store/google");
const { fakeStore, fakeConnector, FakeSheet } = require("./store/fake");
const { memfs } = require("./store/memfs");
const { setBase, base } = require("./base");
const { modelFromStandard, snapshotFromStandard, UNSTATED } = require("./model");
const { fileWords, moveStore } = require("./first-file");
const { proposeRecipe, tryRecipe, rowWords } = require("./guess");
const { TABS, MANAGED, STANDARD_VERSION, RUNTIME_VERSION } = require("./tabs");

module.exports = {
  init, add, addRecipe, record, status, readiness, next, pick, decide, close, rebuildAt, loadOriginals, bytesState, readState, sampleOf, sha256,
  folderStore, googleStore, createSpreadsheet, NEEDS, fakeStore, fakeConnector, FakeSheet, memfs,
  replayWorld, treeHash, tableHashes, setBase, base, modelFromStandard, snapshotFromStandard, UNSTATED, fileWords, moveStore, proposeRecipe, tryRecipe, rowWords, TABS, MANAGED, DOMAINS, STANDARD_VERSION, RUNTIME_VERSION,
};
