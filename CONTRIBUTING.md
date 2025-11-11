# Contributing

Thank you for your interest in contributing to the OpenZeppelin Docs! We welcome contributions from everyone.

## How to Contribute

Please follow this guide if you have something to contribute.

### Reporting Issues

If you find a bug or have a suggestion for improvement:

1. Check if the issue already exists in [GitHub issues](https://github.com/OpenZeppelin/docs/issues)
2. If not, create a new issue with a clear description
3. Wait for a team member to comment before moving forward with a pull request

### Making Changes

1. Fork the repository
2. Create a new branch for your change
3. Follow the local development guide in the [README](README.md) or with the steps [below](#development-setup)
4. Use [conventional commits](https://www.conventionalcommits.org/) when making changes
5. Make sure your changes follow the [OpenZeppelin Docs Standards](STANDARDS.md)
6. Submit a pull request

### Pull Request Guidelines

- Keep pull requests focused on a single feature or fix
- Write clear commit messages
- Spelling fixes should be grouped as much as possible (i.e. fixing multiple errors instead of just one)

### Development Setup

1. Make sure [pnpm](https://pnpm.io) is installed

```bash
pnpm --version
```

2. Clone the repo and install dependencies

```bash
git clone https://github.com/OpenZeppelin/docs
cd docs
pnpm install
```

3. Run the `dev` server to see a live preview and have your changes reflected at `http://localhost:3000`

```bash
pnpm dev
```

4. After making changes run the lint command to make formatting rules are applied

```bash
pnpm run check:fix
```

## Code of Conduct

Please be respectful and constructive in all interactions. We strive to maintain a welcoming and inclusive environment for all contributors.

## Questions?

If you have questions about contributing, feel free to open an issue or reach out to the maintainers.
