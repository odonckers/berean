package library

import (
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

type fixture struct {
	pub, issue, file, sum string
}

func fetchFixture(t *testing.T, f fixture) string {
	t.Helper()
	dir := filepath.Join(moduleRoot(t), "testdata", "cache")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	dest := filepath.Join(dir, f.file)
	if fileMD5(dest) == f.sum {
		return dest
	}
	url, err := mediaURL(f)
	if err != nil {
		t.Skipf("offline: cannot look up %s: %v", f.file, err)
	}
	if err := download(url, dest, f.sum); err != nil {
		t.Skipf("offline: cannot fetch %s: %v", f.file, err)
	}
	return dest
}

func moduleRoot(t *testing.T) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	return filepath.Clean(filepath.Join(filepath.Dir(file), "..", ".."))
}

func mediaURL(f fixture) (string, error) {
	u := "https://b.jw-cdn.org/apis/pub-media/GETPUBMEDIALINKS?output=json&langwritten=E&fileformat=JWPUB&pub=" + f.pub
	if f.issue != "" {
		u += "&issue=" + f.issue
	}
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Get(u)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("GETPUBMEDIALINKS status %s", resp.Status)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	var v any
	if err := json.Unmarshal(body, &v); err != nil {
		return "", err
	}
	found := ""
	var walk func(any)
	walk = func(n any) {
		switch t := n.(type) {
		case map[string]any:
			url, _ := t["url"].(string)
			sum, _ := t["checksum"].(string)
			if url != "" && strings.EqualFold(sum, f.sum) {
				found = url
			}
			for _, c := range t {
				walk(c)
			}
		case []any:
			for _, c := range t {
				walk(c)
			}
		}
	}
	walk(v)
	if found == "" {
		return "", fmt.Errorf("checksum %s not in media links", f.sum)
	}
	return found, nil
}

func download(url, dest, sum string) error {
	client := &http.Client{Timeout: 5 * time.Minute}
	resp, err := client.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download status %s", resp.Status)
	}
	tmp := dest + ".part"
	out, err := os.OpenFile(tmp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	h := md5.New()
	if _, err := io.Copy(out, io.TeeReader(resp.Body, h)); err != nil {
		out.Close()
		os.Remove(tmp)
		return err
	}
	if err := out.Close(); err != nil {
		os.Remove(tmp)
		return err
	}
	got := hex.EncodeToString(h.Sum(nil))
	if !strings.EqualFold(got, sum) {
		os.Remove(tmp)
		return fmt.Errorf("checksum %s, want %s", got, sum)
	}
	return os.Rename(tmp, dest)
}

func fileMD5(path string) string {
	f, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer f.Close()
	h := md5.New()
	if _, err := io.Copy(h, f); err != nil {
		return ""
	}
	return hex.EncodeToString(h.Sum(nil))
}
