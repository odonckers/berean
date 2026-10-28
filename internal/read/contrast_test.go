package read

import "testing"

func TestTextContrast(t *testing.T) {
	for _, dark := range []bool{false, true} {
		mode := "light"
		if dark {
			mode = "dark"
		}
		for _, p := range contrastPairs(dark) {
			got := contrastRatio(p.fg, p.bg)
			min := 4.5
			if p.large {
				min = 3
			}
			t.Logf("%s %s: %.2f", mode, p.name, got)
			if got < min {
				t.Errorf("%s %s contrast %.2f, want >= %.1f", mode, p.name, got, min)
			}
		}
	}
}

// TestSystemFillsFailAsText records why text does not use the system
// colors. Those stay the fills. Painting them as text drops below 4.5:1,
// which is the case the contrast test guards.
func TestSystemFillsFailAsText(t *testing.T) {
	light := appleTheme(false)
	resolved := coverTint(light.Accent, 0.18, light.Surface)
	marked := coverTint(light.Accent, 0.16, light.Background)
	broken := coverTint(light.Danger, 0.16, light.Surface)
	fails := []struct {
		name string
		got  float64
	}{
		{"resolved chip, system blue", contrastRatio(light.Accent, resolved)},
		{"link on background, system blue", contrastRatio(light.Accent, light.Background)},
		{"link on marked row, system blue", contrastRatio(light.Accent, marked)},
		{"danger on background, system red", contrastRatio(light.Danger, light.Background)},
		{"broken chip, system red", contrastRatio(light.Danger, broken)},
		{"warning on background, system orange", contrastRatio(light.Warning, light.Background)},
	}
	for _, f := range fails {
		t.Logf("before %s: %.2f", f.name, f.got)
		if f.got >= 4.5 {
			t.Errorf("before %s is %.2f, the guard expects the system color to fail 4.5:1", f.name, f.got)
		}
	}
	dark := appleTheme(true)
	darkChip := coverTint(dark.Accent, 0.18, dark.Surface)
	got := contrastRatio(dark.Accent, darkChip)
	t.Logf("before dark resolved chip, system blue: %.2f", got)
	if got >= 4.5 {
		t.Errorf("dark resolved chip with system blue is %.2f, want it under 4.5", got)
	}
}
