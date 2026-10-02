from workagent.fixture import generate


def test_calculation_is_derived_unique_union_and_percentage():
    rows = [{'id': str(i), 'owner_recorded': i >= 2, 'next_action_recorded': i >= 4} for i in range(8)]
    bodies, unresolved = generate([{'content': {'rows': rows + [rows[0]]}}])
    evidence = next(b.text for b in bodies[0].blocks if b.block_id == 'evidence')
    assert '4 of 8' in evidence and '4/8 = 50%' in evidence
    assert not unresolved
    rows = [{'id': str(i), 'owner_recorded': i != 0, 'next_action_recorded': True} for i in range(5)]
    bodies, _ = generate([{'content': {'rows': rows}}])
    assert '1/5 = 20%' in next(b.text for b in bodies[0].blocks if b.block_id == 'evidence')


def test_missing_rows_never_claim_a_percentage():
    bodies, unresolved = generate([{'content': {}}])
    assert unresolved
    assert '%' not in next(b.text for b in bodies[0].blocks if b.block_id == 'evidence')
