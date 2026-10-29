"""Fixed entrypoint inside the MCP jail; not a general script runner."""
import sys

sys.path[:0] = ['/packages', '/app']
from workagent.connectors.synthetic_server import server

if __name__ == '__main__':
    server.run(transport='stdio')
