# Git Setup Instructions

## Step 1: Initialize Git (Run These Commands)

Open your terminal in the project directory and run:

```bash
# Initialize Git repository
git init

# Add all files
git add .

# Create first commit with working button configuration
git commit -m "feat: Working WhatsApp interactive buttons (Call, URL, Quick Reply all functional)"
```

## Step 2: Create a Backup Tag (Important!)

```bash
# Tag this working version
git tag -a v1.0-buttons-working -m "All WhatsApp buttons working correctly - Dec 18, 2025"
```

## Step 3: Set Up Remote Repository (Recommended)

### Option A: GitHub
1. Create a new repository on GitHub
2. Link it:
```bash
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git branch -M main
git push -u origin main
git push origin --tags
```

### Option B: GitLab/Bitbucket
Similar process - create repo and follow their instructions

## Daily Workflow

### Before Making Changes:
```bash
# Create a new branch for experiments
git checkout -b feature/your-feature-name
```

### After Making Changes:
```bash
# See what changed
git status

# Add specific files
git add lib/baileys-hybrid.ts
git add lib/whatsapp.ts

# Or add all changes
git add .

# Commit with descriptive message
git commit -m "fix: updated button logic"

# Push to remote (if set up)
git push origin feature/your-feature-name
```

### If Something Breaks - Rollback:

#### Rollback to last commit:
```bash
git reset --hard HEAD
```

#### Rollback to working button version:
```bash
git checkout v1.0-buttons-working
```

#### Restore specific file:
```bash
git checkout v1.0-buttons-working -- lib/baileys-hybrid.ts
```

## Quick Reference

| Command | What It Does |
|---------|-------------|
| `git status` | See what's changed |
| `git diff` | See exact changes |
| `git log` | See commit history |
| `git checkout <file>` | Discard changes to file |
| `git reset --hard HEAD` | Discard ALL changes |
| `git tag -l` | List all tags |
| `git checkout <tag>` | Go to specific version |

## Important: Commit Regularly!

**Good Practice:**
- Commit after each working feature
- Use descriptive commit messages
- Tag important milestones
- Push to remote daily

**Example Workflow:**
```bash
# Morning: Start work
git pull origin main

# After fixing a bug
git add .
git commit -m "fix: call button phone number format"

# After adding feature
git add .
git commit -m "feat: added quick reply support"

# End of day
git push origin main
```

## Emergency Backup (No Git)

If you don't want to use Git, at minimum:

1. **Copy these files regularly:**
   - `lib/baileys-hybrid.ts`
   - `lib/whatsapp.ts`
   - `WHATSAPP_BUTTONS_WORKING_CONFIG.md`

2. **Save to:**
   - External drive
   - Cloud storage (Google Drive, Dropbox)
   - Different folder with date: `backup-2025-12-18/`

## Need Help?

- Git documentation: https://git-scm.com/doc
- GitHub guides: https://guides.github.com/
- Git cheatsheet: https://education.github.com/git-cheat-sheet-education.pdf

