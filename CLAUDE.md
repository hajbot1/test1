# CLAUDE.md

This file provides guidance for AI assistants (Claude and others) working with this repository.

## Repository Status

This repository is currently **empty** — no source code, dependencies, build configuration, or CI/CD pipelines exist yet. Update this file as the project evolves.

---

## Project Overview

> **TODO:** Add a brief description of what this project does, its purpose, and its intended audience.

---

## Repository Structure

> **TODO:** Document the directory layout once source files are added. Example format:

```
/
├── src/          # Application source code
├── tests/        # Test suites
├── docs/         # Documentation
└── CLAUDE.md     # This file
```

---

## Development Setup

> **TODO:** Add setup instructions. Include:
> - Required tools and versions (Node.js, Python, Go, etc.)
> - Environment variables and `.env` configuration
> - How to install dependencies
> - How to run the project locally

---

## Common Commands

> **TODO:** Fill in actual commands once the project is configured.

```bash
# Install dependencies
# <command here>

# Run development server
# <command here>

# Run tests
# <command here>

# Run linter / formatter
# <command here>

# Build for production
# <command here>
```

---

## Testing

> **TODO:** Describe the testing approach:
> - Testing framework(s) in use
> - How to run the full test suite
> - How to run a single test or test file
> - Coverage requirements or thresholds

---

## Code Conventions

> **TODO:** Document conventions as they are established. Common items to include:

- **Formatting:** Which formatter is used and how it is enforced (e.g., Prettier, Black, gofmt)
- **Linting:** Which linter rules are enforced
- **Naming:** File naming conventions, variable/function naming patterns
- **Imports:** Import ordering and grouping rules
- **Comments:** When and how to write comments

---

## Architecture & Key Concepts

> **TODO:** Explain the high-level architecture and any non-obvious design decisions. Include:
> - Core modules and their responsibilities
> - Data flow and key interfaces
> - External services or APIs the project depends on
> - Any design patterns or architectural patterns in use

---

## Git Workflow

- **Default branch:** `main` (or `master` — update once established)
- **Feature branches:** Use descriptive names, e.g., `feat/add-auth`, `fix/login-bug`
- **Commit messages:** Use [Conventional Commits](https://www.conventionalcommits.org/) format when possible:
  - `feat:` new feature
  - `fix:` bug fix
  - `docs:` documentation only
  - `chore:` maintenance / tooling
  - `refactor:` code change with no behavior change
  - `test:` adding or updating tests

---

## CI/CD

> **TODO:** Describe the CI/CD pipeline once it is configured. Include:
> - Which platform is used (GitHub Actions, GitLab CI, CircleCI, etc.)
> - What checks run on pull requests (lint, test, build)
> - Deployment targets and how releases are triggered

---

## Environment Variables

> **TODO:** List required environment variables and their purpose. Example:

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | Connection string for the primary database |
| `API_KEY` | Yes | API key for the external service |
| `LOG_LEVEL` | No | Logging verbosity (`debug`, `info`, `warn`, `error`) |

Never commit secrets or `.env` files to the repository.

---

## For AI Assistants

- This file should be kept up to date as the project grows
- When adding new major features or changing conventions, update the relevant section above
- Prefer editing existing files over creating new ones unless a new file is clearly needed
- Always read existing code before proposing changes to it
- Follow the established conventions in each file rather than introducing new patterns
