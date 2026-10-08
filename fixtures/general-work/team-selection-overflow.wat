;; Intentional synthetic obstacle, NOT a correct implementation.
;; Final combination counts fit i64, but intermediate multiplication can overflow.
(module
  (func (export "choose") (param $n i64) (param $k i64) (result i64)
    (local $r i64) (local $i i64)
    i64.const 1 local.set $r
    i64.const 1 local.set $i
    block $done
      loop $step
        local.get $i local.get $k i64.gt_s br_if $done
        local.get $r local.get $n local.get $i i64.sub i64.const 1 i64.add
        i64.mul local.get $i i64.div_s local.set $r
        local.get $i i64.const 1 i64.add local.set $i
        br $step
      end
    end
    local.get $r))
