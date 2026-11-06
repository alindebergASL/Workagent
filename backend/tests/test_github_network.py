"""Explicit parent-run public network probe; not part of deterministic lane checks."""
import json
import os
import pytest
from workagent.connectors import github_read as G
from workagent.capabilities.github_adapters import GitHubDiscover, GitHubRead

pytestmark=pytest.mark.skipif(os.environ.get('WORKAGENT_PUBLIC_NETWORK_TEST')!='1',
    reason='explicit opt-in live public network evidence only')


def test_actual_public_github_commit_readme_and_blob():
    discovery=GitHubDiscover(kind='github_discover',repository='octocat/Hello-World',resource='readme',page=1,per_page=1)
    response=G.fetch(discovery)
    assert response['status']=='available',response['status']
    commit=json.loads(G.evidence(discovery,response)['text'])['evidence']['commit']
    request=GitHubRead(kind='github_read',repository=discovery.repository,resource='readme',number=None,
        commit=commit,expected_response_sha256=None)
    response=G.fetch(request)
    assert response['status']=='available',response['status']
    provenance=json.loads(G.evidence(request,response)['text'])['provenance']
    assert provenance['commit']==commit and len(provenance['blob_sha'])==40
