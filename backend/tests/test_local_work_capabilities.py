"""Pure B2/B3 capability checks; no DB, model or network dependencies."""
import unittest

from workagent.local_operations import reconcile_csv, OperationRejected
from workagent.wasm_tool import run_wasm_tool, ToolRejected

CSV = 'id,quantity,unit_price,reported_total,note\nA,2,19.95,39.90,Keep my wording\nB,3,12.50,38.50,Await credit\nC,0,7.25,0.00,\n'
TOOL = '(module (func (export "total") (param i64 i64) (result i64) local.get 0 local.get 1 i64.mul))'


class OperationsTests(unittest.TestCase):
    def test_actual_decimal_reconciliation_and_unchanged_input(self):
        result = reconcile_csv(CSV)
        self.assertEqual(result['discrepancies'], ['B'])
        self.assertEqual(result['expected_sum'], '77.40')
        self.assertEqual(result['reported_sum'], '78.40')
        self.assertEqual(result['rows'][0]['note'], 'Keep my wording')
        self.assertEqual(result['rows'][1]['reported_total'], '38.50')
        self.assertEqual(result['rows'][1]['calculated_total'], '37.50')
        self.assertEqual(result['rows'][1]['difference'], '1.00')
        self.assertIn('quantity * unit_price', result['formula'])
        self.assertIn('calculated_total', result['csv'])
        self.assertEqual(CSV.count('calculated_total'), 0)

    def test_human_notes_survive_changed_input_requirement(self):
        revised = CSV.replace('Await credit', 'Human: do not send invoice')
        result = reconcile_csv(revised, rounding='ROUND_HALF_EVEN')
        self.assertEqual(result['rows'][1]['note'], 'Human: do not send invoice')
        self.assertEqual(result['rounding'], 'ROUND_HALF_EVEN')

    def test_reject_bad_or_ambiguous_inputs_instead_of_inventing_values(self):
        bad = [CSV.replace('12.50', ''), CSV.replace('12.50', 'NaN'),
               CSV.replace('12.50', '1e200'), CSV.replace('B,3', 'A,3'),
               CSV.replace('id,quantity', 'id,id'), CSV.replace('Await credit', '=CMD()'),
               CSV.replace('B,3', 'B,3.5'), CSV.replace('12.50', '12.5.0'),
               CSV.replace('note\n', 'calculated_total\n'),
               CSV.replace('Await credit\n', 'Await credit,EXTRA\n')]
        for data in bad:
            with self.subTest(data=data), self.assertRaises(OperationRejected):
                reconcile_csv(data)


class WasmTests(unittest.TestCase):
    def test_real_execution_and_requirement_change(self):
        r = run_wasm_tool(TOOL, 'total', [3,1250])
        self.assertEqual(r['value'], 3750)
        self.assertEqual(r['engine'], 'wasmtime-49.0.0')
        self.assertTrue(r['execution_observed'])
        updated = '(module (func (export "total") (param i64 i64 i64) (result i64) local.get 0 local.get 1 i64.mul local.get 2 i64.add))'
        self.assertEqual(run_wasm_tool(updated, 'total', [3,1250,500])['value'],4250)
        self.assertNotEqual(r['code_sha256'],run_wasm_tool(updated,'total',[3,1250,500])['code_sha256'])

    def test_imports_and_wasi_have_no_authority(self):
        for module in ['(module (import "env" "read_private" (func)))', '(module (import "wasi_snapshot_preview1" "fd_write" (func)))']:
            with self.assertRaises(ToolRejected):run_wasm_tool(module,'total',[])

    def test_fuel_bounds_nontermination(self):
        with self.assertRaises(ToolRejected):
            run_wasm_tool('(module (func (export "total") (result i64) (loop $l br $l) i64.const 0))','total',[])

    def test_engine_version_fails_closed(self):
        from unittest.mock import patch
        with patch('workagent.wasm_tool.importlib.metadata.version', return_value='0.0.0'):
            with self.assertRaises(ToolRejected):run_wasm_tool(TOOL,'total',[2,3])

    def test_start_function_is_also_fuel_bounded(self):
        code = '(module (func $start (loop $l br $l)) (start $start) (func (export "total") (result i64) i64.const 1))'
        with self.assertRaises(ToolRejected):run_wasm_tool(code,'total',[])

    def test_memory_limit_and_types_and_missing_entrypoint(self):
        for code,name,values in [
            ('(module (memory 1000) (func (export "total") (result i64) i64.const 0))','total',[]),
            (TOOL,'total',[True,2]),(TOOL,'total',[2]),(TOOL,'missing',[1,2]),
            ('(module (func (export "total") (result f64) f64.const 1))','total',[]),
            (TOOL,'total',[10**30,2]),('x'*20000,'total',[])]:
            with self.subTest(name=name,values=values),self.assertRaises(ToolRejected):run_wasm_tool(code,name,values)


if __name__ == '__main__':unittest.main()
