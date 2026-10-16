"""Fixed-shape diagnostics, without exposing exception or provider values."""
import json
from types import SimpleNamespace
import psycopg
import pytest
from workagent.responses_dispatcher import runtime_failure_diagnostic
from workagent.responses_worker import ResponsesWorker


@pytest.mark.parametrize('error,category',[
    (RuntimeError('SECRET runtime payload'),'runtime_failure'),
    (psycopg.errors.QueryCanceled('SECRET SQL'),'database_timeout'),
    (psycopg.errors.DeadlockDetected('SECRET SQL'),'database_conflict'),
    (psycopg.OperationalError('SECRET connection'),'database_unavailable'),
])
def test_runtime_failure_has_only_fixed_categories(error,category):
    try: raise error
    except Exception as caught: result=runtime_failure_diagnostic(caught,'run-synthetic')
    assert result=={'event':'runtime_operation_failed','run_id':'run-synthetic',
                    'category':category,'stage':'runtime'}
    assert 'SECRET' not in json.dumps(result)


def test_failed_postcommit_authority_check_logs_without_claiming_retry(caplog):
    worker=ResponsesWorker.__new__(ResponsesWorker)
    def unavailable(cap,deadline): raise psycopg.errors.QueryCanceled('SECRET SQL and parameters')
    worker._http_ready=unavailable
    request=SimpleNamespace(metadata=SimpleNamespace(request_id='run-synthetic',attempt_id='attempt-synthetic'),phase='selection_3')
    with pytest.raises(psycopg.errors.QueryCanceled):
        worker._after_reservation_ready(request,'count_send',None,0)
    record=json.loads(caplog.records[-1].message)
    assert record=={'event':'provider_io_not_started','run_id':'run-synthetic',
        'attempt_id':'attempt-synthetic','phase':'selection_3','operation':'count_send',
        'reason':'pre_io_check_error','reservation_committed':True}
    assert 'SECRET' not in caplog.text
