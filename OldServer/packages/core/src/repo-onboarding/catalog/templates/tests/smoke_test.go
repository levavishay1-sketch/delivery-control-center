// Smoke test written by DCC onboarding: proves `go test ./...` can run here.
// The package name is a guess (go.mod was not read when this was written);
// rename it to the package of the folder it sits in.
package main

import "testing"

func TestSmoke(t *testing.T) {
	if 1+1 != 2 {
		t.Fatal("arithmetic is broken")
	}
}
