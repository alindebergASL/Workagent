import uvicorn
from .api import Settings


def main():
    Settings.environment().validate()
    uvicorn.run('workagent.api:app', host='127.0.0.1', port=8000, proxy_headers=False)


if __name__ == '__main__':
    main()
