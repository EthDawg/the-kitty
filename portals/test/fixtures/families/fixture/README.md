# A hand-made family

The smallest family that keeps the contract with the life generator: `manifest.json` (the vault fields plus `person` and `delivered_on`), the files it names, `setup/party.json` and `mess.json`. `node portals/build-vault.js --fixture` loads it, and `test/family.spec.js` proves the portals serve it. It is never deployed. Fiction, and small on purpose.
