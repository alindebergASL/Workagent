import { beforeEach } from "vitest";
import { bindTestScope } from "./scope-helper";

// Every test starts in a page bound to a proven (test) session scope; the
// A14 tests reset it to prove the unbound and changed cases.
beforeEach(bindTestScope);
