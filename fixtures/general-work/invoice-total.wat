(module
  (func (export "total") (param $quantity i64) (param $unit_cents i64) (result i64)
    local.get $quantity
    local.get $unit_cents
    i64.mul))
