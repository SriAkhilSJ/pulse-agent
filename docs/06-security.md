# Security Model

## HITL Gates (Human-in-the-Loop)

These operations require human approval:
- Deleting files
- Modifying .env/secrets
- Running database migrations
- Installing dependencies
- Pushing to remote git
- Deploying to production

## Auto-Rejected Operations

- `rm -rf /` or equivalent
- Modifying SSH keys
- Sending code to unapproved services
- Modifying system PATH
