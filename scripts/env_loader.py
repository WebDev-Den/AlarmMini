import os
from pathlib import Path


def load_dotenv(project_dir: str) -> None:
    """
    Lightweight .env loader.
    Existing environment variables always take precedence.
    """
    env_path = Path(project_dir) / ".env"
    if not env_path.is_file():
        return

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if not key:
            continue

        if value and ((value[0] == value[-1]) and value[0] in ("'", '"')):
            value = value[1:-1]

        if key not in os.environ:
            os.environ[key] = value
