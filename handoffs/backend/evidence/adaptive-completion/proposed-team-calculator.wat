(module
 (func (export "choose_team") (param $n i64) (param $k i64) (result i64)
  (local $r i64) (local $i i64)
  (if (i32.or (i32.or (i64.lt_s (local.get $n) (i64.const 0)) (i64.gt_s (local.get $n) (i64.const 60))) (i32.or (i64.lt_s (local.get $k) (i64.const 0)) (i64.gt_s (local.get $k) (local.get $n))))
   (then (return (i64.const -1))))
  (if (i64.gt_s (local.get $k) (i64.sub (local.get $n) (local.get $k)))
   (then (local.set $k (i64.sub (local.get $n) (local.get $k)))))
  (local.set $r (i64.const 1))
  (local.set $i (i64.const 1))
  (block $end (loop $step
   (br_if $end (i64.gt_s (local.get $i) (local.get $k)))
   (local.set $r (i64.div_s
    (i64.mul (local.get $r) (i64.add (i64.sub (local.get $n) (local.get $k)) (local.get $i)))
    (local.get $i)))
   (local.set $i (i64.add (local.get $i) (i64.const 1)))
   (br $step)))
  (local.get $r)))