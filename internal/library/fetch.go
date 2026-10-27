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
	"time"
)

// FetchFixture downloads a publication into testdata/cache, which is
// gitignored. Tests use it. The checksum is the MD5 from GETPUBMEDIALINKS.
// An error means the file could not be fetched, which tests treat as a skip
// when the machine is offline.
func FetchFixture(pub, issue, file, sum string) (string, error) {
	root, err := moduleRoot()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(root, "testdata", "cache")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	dest := filepath.Join(dir, file)
	if fileMD5(dest) == sum {
		return dest, nil
	}
	url, err := mediaURL(pub, issue, sum)
	if err != nil {
		return "", fmt.Errorf("offline: cannot look up %s: %w", file, err)
	}
	if err := download(url, dest, sum); err != nil {
		return "", fmt.Errorf("offline: cannot fetch %s: %w", file, err)
	}
	return dest, nil
}

func moduleRoot() (string, error) {
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		return "", fmt.Errorf("runtime.Caller failed")
	}
	return filepath.Clean(filepath.Join(filepath.Dir(file), "..", "..")), nil
}

func mediaURL(pub, issue, sum string) (string, error) {
	u := "https://b.jw-cdn.org/apis/pub-media/GETPUBMEDIALINKS?output=json&langwritten=E&fileformat=JWPUB&pub=" + pub
	if issue != "" {
		u += "&issue=" + issue
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
			got, _ := t["checksum"].(string)
			if url != "" && strings.EqualFold(got, sum) {
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
		return "", fmt.Errorf("checksum %s not in media links", sum)
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
