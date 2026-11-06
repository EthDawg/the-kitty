# Examples

Fiction. The Digital Davies are invented, and so is every figure, employer, bank and address here. Experimental, and not tax advice. Preparation complete is not lodged.

- **[`tax-pack/`](tax-pack/)** A real zip for each Davies parent for FY2023-24, as of 5 August 2024: statements in, return not yet lodged. A second rental bought mid-year, shares and crypto sold, an amendment to the year before. Unzip one and open `Tax pack.xlsx`.
- **[`lender-pack/`](lender-pack/)** The same shape, for a lender: two people, one day, what they earn and owe.
- **[`tax-kit/`](tax-kit/)** The kit for anyone: the same workbook, empty, and how it compares with the kit it replaces.

Everything in the two pack folders and the workbook in the kit folder is generated. Change the code, not the files:

```bash
node standard/world/build.js
node src/household/pack/cli.js examples --out docs/examples
```

The agent's half is [`skills/kitty-tax-pack`](../../skills/kitty-tax-pack/SKILL.md). The code and what it could not answer are in [`src/household/pack`](../../src/household/pack/).
