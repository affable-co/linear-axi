# Development

```sh
pnpm install
pnpm run build        # tsc → dist/
pnpm test             # vitest
pnpm run dev -- issue list   # run from source
pnpm run build:skill  # regenerate skills/linear-axi/SKILL.md (--check in CI)
```

# Publishing

The Agent Skill and CLI use separate release channels. Merging changes under
`skills/linear-axi/` to `main` publishes a new GitHub-backed skill revision. Publishing a GitHub
Release tagged `v<package version>` runs `.github/workflows/publish.yml`, verifies the generated
skill and test suite, and publishes the CLI as `@affable-co/linear-axi` to npmjs and GitHub
Packages.

For the first npmjs release, add a one-time `NPM_TOKEN` repository secret from an npm account
authorized for the `@affable-co` scope. After that release creates the package, configure npm
Trusted Publishing for organization `affable-co`, repository `linear-axi`, workflow `publish.yml`,
with `npm publish` allowed, then delete the secret. Subsequent npmjs releases authenticate through
GitHub OIDC and do not require an npm token. GitHub Packages publishes with the workflow
`GITHUB_TOKEN` (`packages: write`); no extra secret is required.

Install from GitHub Packages by pointing the `@affable-co` scope at the registry:

```ini
# .npmrc
@affable-co:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=YOUR_GITHUB_TOKEN
```

For each release, update `package.json`, regenerate the skill when its guidance changed, merge to
`main`, and create a GitHub Release whose tag exactly matches the version, such as `v0.1.1`.
