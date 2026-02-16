# Contributing to Micrio Client

First off, thank you for considering contributing to Micrio! It's people like you that make this project better for everyone.

## Code of Conduct

This project and everyone participating in it is governed by our commitment to:
- Being respectful and constructive
- Focusing on what's best for the community
- Showing empathy towards others

## How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check the [existing issues](https://github.com/Q42/Micrio.Client/issues) to avoid duplicates. When you create a bug report, please include as many details as possible:

- **Use a clear and descriptive title**
- **Describe the exact steps to reproduce the problem**
- **Provide specific examples** (code snippets, URLs if applicable)
- **Describe the behavior you observed** and what behavior you expected
- **Include screenshots or GIFs** if applicable

### Suggesting Enhancements

Enhancement suggestions are tracked as GitHub issues. When creating an enhancement suggestion:

- **Use a clear and descriptive title**
- **Provide a step-by-step description of the suggested enhancement**
- **Provide specific examples** to demonstrate the enhancement
- **Explain why this enhancement would be useful**

### Pull Requests

1. Fork the repository
2. Create a new branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run the type checker (`pnpm run typecheck`)
5. Commit your changes (`git commit -m 'Add amazing feature'`)
6. Push to the branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request

## Development Setup

### Prerequisites

- Node.js >= 18.17.0
- pnpm

### Installation

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/Micrio.Client.git
cd Micrio.Client

# Install dependencies
pnpm i

# Build the WebAssembly module
pnpm run asbuild:optimized

# Start development server
pnpm run dev
```

The dev server will start at http://localhost:2000/

## Project Structure

- `src/ts/` - TypeScript core logic
- `src/svelte/` - Svelte UI components
- `src/wasm/` - AssemblyScript WebAssembly code
- `src/types/` - TypeScript type definitions
- `public/` - Static assets and compiled output

## Working with WebAssembly

After making changes to `src/wasm/`:

```bash
pnpm run asbuild:optimized
```

For debugging with stack traces:
```bash
pnpm run asbuild:untouched
```

## Style Guidelines

### TypeScript

- Use TypeScript for all new code
- Follow the existing code style
- Run `pnpm run typecheck` before committing

### Git Commit Messages

- Use the present tense ("Add feature" not "Added feature")
- Use the imperative mood ("Move cursor to..." not "Moves cursor to...")
- Limit the first line to 72 characters or less
- Reference issues and pull requests liberally after the first line

## Recognition

Contributors will be recognized in our release notes and documentation.

## Questions?

Feel free to open an issue for any questions, or contact us at support@micr.io

Thank you for contributing! 🎉
