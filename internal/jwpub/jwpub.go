// Package jwpub reads a .jwpub publication. The file is opened read-only and
// is never modified. Decrypted text is returned to the caller; this package
// does not store it.
package jwpub

import (
	"archive/zip"
	"bytes"
	"compress/zlib"
	"crypto/aes"
	"crypto/cipher"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	_ "modernc.org/sqlite"
)

// contentKeyMask is the fixed mask mixed into the SHA-256 of the publication
// card. It belongs to the JWPUB format, not to this program.
const contentKeyMaskHex = "11cbb5587e32846d4c26790c633da289f66fe5842a3a585ce1bc3a294af5ada7"

// Meta is the publication card, in citation form.
type Meta struct {
	Language   int
	Symbol     string // file symbol, such as w23 or nwtsty
	CiteSymbol string // undated citation symbol, such as w or nwtsty
	Year       int
	IssueTag   int // YYYYMMDD, or 0 when the publication has no issue
	Month      int
	Day        int
	Title      string
	ShortTitle string
	IssueTitle string
	Type       string // PublicationType, such as Bible or Watchtower
}

// Bible reports whether the publication carries verse tables.
func (m Meta) Bible() bool { return m.Type == "Bible" }

// Publication is one opened .jwpub. Close removes the temporary copy of the
// inner database.
type Publication struct {
	meta Meta
	db   *sql.DB
	key  []byte
	iv   []byte
	dir  string
	loc  map[int]verseLoc
}

type verseLoc struct {
	Book, Chapter, Verse int
}

type manifestDoc struct {
	Publication struct {
		FileName string `json:"fileName"`
	} `json:"publication"`
}

// Open reads path. The .jwpub itself is only ever opened for reading.
func Open(path string) (*Publication, error) {
	outer, err := zip.OpenReader(path)
	if err != nil {
		return nil, fmt.Errorf("open %s: %w", path, err)
	}
	defer outer.Close()

	var manifest []byte
	var contents *zip.File
	for _, f := range outer.File {
		switch f.Name {
		case "manifest.json":
			manifest, err = readZipFile(f)
			if err != nil {
				return nil, fmt.Errorf("%s: manifest: %w", path, err)
			}
		case "contents":
			contents = f
		}
	}
	if manifest == nil || contents == nil {
		return nil, fmt.Errorf("%s: not a JWPUB (missing manifest or contents)", path)
	}
	var mf manifestDoc
	if err := json.Unmarshal(manifest, &mf); err != nil {
		return nil, fmt.Errorf("%s: manifest: %w", path, err)
	}
	dbName := mf.Publication.FileName
	if dbName == "" || dbName != filepath.Base(dbName) || strings.Contains(dbName, "..") {
		return nil, fmt.Errorf("%s: invalid inner database name %q", path, dbName)
	}

	dir, err := os.MkdirTemp("", "berean-jwpub-")
	if err != nil {
		return nil, err
	}
	done := false
	defer func() {
		if !done {
			os.RemoveAll(dir)
		}
	}()

	contentsPath := filepath.Join(dir, "contents.zip")
	if err := writeZipFile(contents, contentsPath); err != nil {
		return nil, fmt.Errorf("%s: contents: %w", path, err)
	}
	dbPath := filepath.Join(dir, dbName)
	if err := extractNamed(contentsPath, dbName, dbPath); err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	if err := os.Remove(contentsPath); err != nil {
		return nil, err
	}

	db, err := openReadOnly(dbPath)
	if err != nil {
		return nil, err
	}
	p := &Publication{db: db, dir: dir}
	if err := p.loadMeta(); err != nil {
		db.Close()
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	done = true
	return p, nil
}

// Close closes the inner database and deletes the temporary copy.
func (p *Publication) Close() error {
	var err error
	if p.db != nil {
		err = p.db.Close()
		p.db = nil
	}
	if p.dir != "" {
		if rerr := os.RemoveAll(p.dir); err == nil {
			err = rerr
		}
		p.dir = ""
	}
	return err
}

// Meta returns the publication card.
func (p *Publication) Meta() Meta { return p.meta }

func (p *Publication) loadMeta() error {
	var (
		lang                           int
		symbol, undated, title, shortT string
		year                           int
		issue, pubType                 string
	)
	err := p.db.QueryRow(`
		SELECT MepsLanguageIndex, Symbol, COALESCE(UndatedSymbol, ''),
		       Year, COALESCE(IssueTagNumber, '0'),
		       COALESCE(Title, ''), COALESCE(ShortTitle, ''),
		       COALESCE(PublicationType, '')
		FROM Publication`).Scan(&lang, &symbol, &undated, &year, &issue, &title, &shortT, &pubType)
	if err != nil {
		return fmt.Errorf("publication row: %w", err)
	}
	month, day, err := splitIssue(issue)
	if err != nil {
		return err
	}
	issueTag := 0
	if strings.TrimSpace(issue) != "" && strings.TrimSpace(issue) != "0" {
		issueTag, err = strconv.Atoi(strings.TrimSpace(issue))
		if err != nil {
			return fmt.Errorf("issue tag %q: %w", issue, err)
		}
	}
	cite := undated
	if cite == "" {
		cite = symbol
	}
	key, iv, err := deriveKey(lang, symbol, year, issue)
	if err != nil {
		return err
	}
	p.key, p.iv = key, iv
	p.meta = Meta{
		Language:   lang,
		Symbol:     symbol,
		CiteSymbol: cite,
		Year:       year,
		IssueTag:   issueTag,
		Month:      month,
		Day:        day,
		Title:      title,
		ShortTitle: shortT,
		Type:       pubType,
	}
	var hasIssue int
	if err := p.db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='PublicationIssueProperty'`).Scan(&hasIssue); err != nil {
		return err
	}
	if hasIssue == 1 {
		var issueTitle string
		err := p.db.QueryRow(`SELECT COALESCE(Title, '') FROM PublicationIssueProperty LIMIT 1`).Scan(&issueTitle)
		if err != nil && err != sql.ErrNoRows {
			return err
		}
		p.meta.IssueTitle = issueTitle
	}
	return nil
}

func splitIssue(tag string) (month, day int, err error) {
	tag = strings.TrimSpace(tag)
	if tag == "" || tag == "0" {
		return 0, 0, nil
	}
	if len(tag) != 8 {
		return 0, 0, fmt.Errorf("issue tag %q is not YYYYMMDD", tag)
	}
	n, err := strconv.Atoi(tag)
	if err != nil {
		return 0, 0, fmt.Errorf("issue tag %q: %w", tag, err)
	}
	month = (n / 100) % 100
	day = n % 100
	if month < 1 || month > 12 || day > 31 {
		return 0, 0, fmt.Errorf("issue tag %q has a bad month or day", tag)
	}
	return month, day, nil
}

func deriveKey(lang int, symbol string, year int, issue string) (key, iv []byte, err error) {
	card := fmt.Sprintf("%d_%s_%d", lang, symbol, year)
	issue = strings.TrimSpace(issue)
	if issue != "" && issue != "0" {
		card += "_" + issue
	}
	sum := sha256.Sum256([]byte(card))
	mask, err := hex.DecodeString(contentKeyMaskHex)
	if err != nil || len(mask) != len(sum) {
		return nil, nil, fmt.Errorf("content key mask")
	}
	for i := range sum {
		sum[i] ^= mask[i]
	}
	key = append([]byte(nil), sum[:16]...)
	iv = append([]byte(nil), sum[16:]...)
	return key, iv, nil
}

func (p *Publication) decrypt(blob []byte) (string, error) {
	if len(blob) == 0 {
		return "", nil
	}
	if len(blob)%aes.BlockSize != 0 {
		return "", fmt.Errorf("ciphertext length %d is not a multiple of 16", len(blob))
	}
	block, err := aes.NewCipher(p.key)
	if err != nil {
		return "", err
	}
	plain := make([]byte, len(blob))
	cipher.NewCBCDecrypter(block, p.iv).CryptBlocks(plain, blob)
	zr, err := zlib.NewReader(bytes.NewReader(plain))
	if err != nil {
		return "", err
	}
	defer zr.Close()
	var buf bytes.Buffer
	if _, err := io.Copy(&buf, zr); err != nil {
		return "", err
	}
	return buf.String(), nil
}

func openReadOnly(path string) (*sql.DB, error) {
	u := url.URL{Scheme: "file", Path: path, RawQuery: "mode=ro&immutable=1"}
	db, err := sql.Open("sqlite", u.String())
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if err := db.Ping(); err != nil {
		db.Close()
		return nil, err
	}
	if _, err := db.Exec(`PRAGMA query_only = ON`); err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
}

func extractNamed(zipPath, name, dest string) error {
	z, err := zip.OpenReader(zipPath)
	if err != nil {
		return err
	}
	defer z.Close()
	for _, f := range z.File {
		if f.Name != name {
			continue
		}
		return writeZipFile(f, dest)
	}
	return fmt.Errorf("contents has no %s", name)
}

func writeZipFile(f *zip.File, dest string) error {
	rc, err := f.Open()
	if err != nil {
		return err
	}
	defer rc.Close()
	out, err := os.OpenFile(dest, os.O_CREATE|os.O_WRONLY|os.O_EXCL, 0o600)
	if err != nil {
		return err
	}
	defer out.Close()
	if _, err := io.Copy(out, rc); err != nil {
		return err
	}
	return out.Close()
}

func readZipFile(f *zip.File) ([]byte, error) {
	rc, err := f.Open()
	if err != nil {
		return nil, err
	}
	defer rc.Close()
	return io.ReadAll(rc)
}
