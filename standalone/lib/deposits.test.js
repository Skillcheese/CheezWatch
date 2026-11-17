import test from "node:test";
import assert from "node:assert/strict";
import { slotRoles } from "./deposits.js";

test("reads slots and roles from the Lab's role assignment", () => {
  const text = "ROLE ASSIGNMENT\n---------------\nSlot 1   Me                  Melee\nSlot 2   T5 Generic          Health\n\nSUMMARY";
  assert.deepEqual(slotRoles(text), [
    { slot: 1, name: "Me", role: "Melee" },
    { slot: 2, name: "T5 Generic", role: "Health" },
  ]);
});
