import uvicorn
from .api import Settings


def main():
    Settings.environment().validate()
    # Streams rotate after 20s; allow normal drain, then cancel stuck response
    # tasks. This must be a server option, not an ASGI lifespan shutdown hook.
    uvicorn.run('workagent.api:app', host='127.0.0.1', port=8000, proxy_headers=False,
                timeout_graceful_shutdown=25)


if __name__ == '__main__':
    main()
