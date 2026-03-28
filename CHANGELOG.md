# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, adapted for this repository.

## [0.1.0] - 2026-03-27

### Added
- Root project documentation for usage, testing, and contribution flow.

### Changed
- Shared browser package and backup helpers now treat structured `groupPackage` as the canonical group payload.
- Group metadata is now carried as `groupPackage.groupName` instead of a top-level package field.
- Browser runtime helper surfaces now align with runtime-owned remote policy observations and the current profile contract.

### Fixed
- Rotation helper serialization now preserves embedded group metadata needed by browser-host rotation flows.
