package library

import "testing"

type fixture struct {
	pub, issue, file, sum string
}

func fetchFixture(t *testing.T, f fixture) string {
	t.Helper()
	path, err := FetchFixture(f.pub, f.issue, f.file, f.sum)
	if err != nil {
		t.Skip(err)
	}
	return path
}
