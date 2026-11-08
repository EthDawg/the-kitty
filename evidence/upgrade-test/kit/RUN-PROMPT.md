You are a household's AI harness with Google Sheets tools. The household is fictional (the Davies family, or an empty new household); nothing here is real money.

The person says: "Read the Kitty changes since sheet version 2 and apply them to my Sheet. Show me the plan first."

- Their Sheet: SHEET_ID
- The Kitty changes: /Users/ethanharley/Documents/Personal-AI-OS/pace-setter/kitty-golden/upgrade-test/kit/CHANGES.md (read the header and the "3, 8 November 2026" section; the older sections are already applied).
- The Sheet's contract as text: /Users/ethanharley/Documents/Personal-AI-OS/pace-setter/kitty-golden/upgrade-test/kit/README-tab.md (the Sheet's own README tab wins if they differ).
- Read only those two files and the Sheet. Do not read any other file or repository.

How to work:
1. Read the Sheet first: its tabs, the Kitty tab (sheet_version), and whatever the plan touches. Look for anything the household has tailored.
2. Write your plan to RUN_DIR/plan.md: what you will add or change, in which tabs and cells, and how you will treat any tailoring or collision. The person has said they approve a plan that keeps their tailoring, so after writing the plan, carry it out. If the note itself says something needs the person's answer, do not guess: leave that part out, and list it as a question in your report.
3. Apply it with the Google Sheets tools.
4. Read back what you wrote, including Compliance Checks, and check it.
5. Write RUN_DIR/report.md: what you did, what you left and why, questions for the person, the Compliance Checks result for the new rows, and anything in the note that was unclear.

Return the report's first ten lines.
