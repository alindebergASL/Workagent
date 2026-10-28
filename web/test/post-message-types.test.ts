import { describe, expect, it } from "vitest";
import type { components, paths } from "../../contracts/src/client";
import type { Operation } from "@/lib/client/products";
import type { conversationApi } from "@/lib/client/real-api";

type S = components["schemas"];
type MessagesPost =
  paths["/v1/workspaces/{workspace_id}/conversations/{conversation_id}/messages"]["post"];
type SendRequest = NonNullable<
  MessagesPost["requestBody"]
>["content"]["application/json"];
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
const assert = <T extends true>(value: T) => value;

/**
 * Compile-time check that the client's request types are the generated
 * request (Input) schemas the message endpoints accept. The generated Input
 * and Output schemas are currently structurally identical, so this proves
 * compatibility with the endpoint's request body, not that swapping in an
 * Output name would fail to compile.
 */
describe("PostMessage request typing", () => {
  it("uses the generated request side for operations and send", () => {
    const checks = [
      assert<
        Equal<Operation, NonNullable<S["PostMessage-Input"]["operation"]>>
      >(true),
      assert<
        Equal<
          Extract<Operation, { kind: "publish_artifact" }>,
          S["PublishArtifact-Input"]
        >
      >(true),
      assert<
        Equal<
          Parameters<typeof conversationApi.send>[2]["operation"],
          S["PostMessage-Input"]["operation"] | undefined
        >
      >(true),
      assert<Equal<SendRequest, S["PostMessage-Input"]>>(true),
    ];
    expect(checks.every(Boolean)).toBe(true);
  });
});
