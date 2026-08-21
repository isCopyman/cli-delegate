import assert from "node:assert/strict"
import path from "node:path"
import { test } from "node:test"

import { win32FromHostPath } from "../skills/cli-delegate/scripts/lib/paths.mjs"

test("Git Bash drive paths become Win32", () => {
  assert.equal(win32FromHostPath("/d/code/foo", "win32"), path.win32.resolve("D:/code/foo"))
  assert.equal(win32FromHostPath("//c/Users/me", "win32"), path.win32.resolve("C:/Users/me"))
  assert.equal(win32FromHostPath("C:/Users/me", "win32"), path.win32.resolve("C:/Users/me"))
  assert.equal(
    win32FromHostPath("D:\\code\\foo", "win32"),
    path.win32.resolve("D:/code/foo")
  )
})

test("non-Windows paths stay as given", () => {
  assert.equal(win32FromHostPath("/home/me/src", "linux"), "/home/me/src")
})
