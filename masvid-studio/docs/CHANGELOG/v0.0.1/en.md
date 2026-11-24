# OpenMotion 0.0.1

Prepared description for the 0.0.1 stable candidate. The active version series starts here; historical 0.6.x packages and fixed downloads remain available. Publication status is recorded separately in GitHub Releases.

## Highlights

- Connect a supported local Agent to OpenMotion using its own host configuration, including hosts outside the predefined integrations. ([#460](https://github.com/nexu-io/openmotion/pull/460))
- Keep generated media in workspace assets, preview alternatives and adopt a chosen result into the editable project. ([#413](https://github.com/nexu-io/openmotion/pull/413), [#448](https://github.com/nexu-io/openmotion/pull/448))
- Use supported OpenDesign account models for image editing and music generation; available models and usage depend on the signed-in account. ([#423](https://github.com/nexu-io/openmotion/pull/423), [#445](https://github.com/nexu-io/openmotion/pull/445))

## Added and improved

- Preview audio inline with compact waveform controls. ([#391](https://github.com/nexu-io/openmotion/pull/391))
- Choose explicit npm application installation alongside the default source installation route. Candidate builds retain package identity and release-note drafts for review. ([#444](https://github.com/nexu-io/openmotion/pull/444), [#447](https://github.com/nexu-io/openmotion/pull/447), [#464](https://github.com/nexu-io/openmotion/pull/464))

## Fixed

- Recover Windows host setup and legacy workspace installation paths. ([#434](https://github.com/nexu-io/openmotion/pull/434))
- Retry socket-buffer rendering failures with fewer workers. ([#443](https://github.com/nexu-io/openmotion/pull/443))

## Upgrade notes

- Install using `@openmotion/app@latest` after publication, or pin `@openmotion/app@0.0.1`. Existing 0.6.x version ranges and lockfiles require an explicit migration; the tag change does not update existing installations.

- Select one installation route explicitly. Preserve existing projects, credentials and host settings; avoid mixing a source checkout with an npm installation.
- Stable packages use prod template configuration; test packages use DEV. Service access and account configuration remain necessary.

## Known issues

Package-specific acceptance is not established by this description. Before publication, record the actual outstanding issues and supported platforms. Live template access, paid model execution and human audio/video playback are not established by build success.

## Acceptance focus

Verify the selected package's local Agent connection, template access, asset adoption, audio preview and MP4 export. Check an upgrade with existing projects and host settings, and watch/listen to the final output at normal speed. Keep actual results in a private acceptance record; mark unrun checks NOT RUN.
