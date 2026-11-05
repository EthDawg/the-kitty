# Native host acceptance

Milestone 1 establishes the clean main-based source tree, repository shape checks
and a bounded, unsigned simulator build. The temporary launch screen is only a
build scaffold. It is not the product UI or evidence of the offline container.

Run `python3 tools/check_shape.py`, `python3 ios/scripts/generate_project.py`, then
the build command in `.github/workflows/ios.yml`. Build logs/results belong in
ignored `ios/build/` locally and CI artifacts, not Git.

Pending: bundled shared page and offline journeys; Ethan's physical iPhone verdict;
live Google selection and verified writes; import equality and end-to-end proof.
No device acceptance, App Store approval or live Google access is claimed.
