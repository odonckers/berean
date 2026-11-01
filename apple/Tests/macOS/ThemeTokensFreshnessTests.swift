import CupertinoUI
import Foundation
import Testing

/// Proves the checked-in `ThemeTokens.swift` still matches
/// `docs/design/themes/tokens.json`.
///
/// `tokens.json` is the single source of truth (themes-spec.md §12.1), and
/// `apple/scripts/gen-theme-tokens.py` is what copies it into Swift. If someone
/// edits the JSON without regenerating, every hex below diverges and these tests
/// fail — so a stale generated file cannot ship quietly.
///
/// The JSON is located from `#filePath` rather than bundled as a resource,
/// deliberately: bundling it would make the test pass against a stale copy.
@Suite("ThemeTokens freshness")
struct ThemeTokensFreshnessTests {
    // apple/Tests/macOS/ThemeTokensFreshnessTests.swift -> repo root
    private static let repoRoot = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()  // macOS
        .deletingLastPathComponent()  // Tests
        .deletingLastPathComponent()  // apple
        .deletingLastPathComponent()  // <repo root>

    private static let tokensURL = repoRoot
        .appending(path: "docs/design/themes/tokens.json")

    private static func loadTokens() throws -> [String: Any] {
        let data = try Data(contentsOf: tokensURL)
        let object = try JSONSerialization.jsonObject(with: data)
        guard let tokens = object as? [String: Any] else {
            throw FreshnessError("tokens.json is not a JSON object")
        }
        return tokens
    }

    private struct FreshnessError: Error, CustomStringConvertible {
        let description: String
        init(_ description: String) { self.description = description }
    }

    /// Walks a path like `themes.paper.modes.light` and returns the object there.
    private static func object(
        _ tokens: [String: Any],
        at path: String
    ) throws -> [String: Any] {
        var current: Any = tokens
        for key in path.split(separator: ".") {
            guard let dictionary = current as? [String: Any],
                  let next = dictionary[String(key)]
            else {
                throw FreshnessError("tokens.json has nothing at \(path)")
            }
            current = next
        }
        guard let result = current as? [String: Any] else {
            throw FreshnessError("tokens.json's \(path) is not an object")
        }
        return result
    }

    private static func array(
        _ tokens: [String: Any],
        at path: String
    ) throws -> [[String: Any]] {
        var current: Any = tokens
        for key in path.split(separator: ".") {
            guard let dictionary = current as? [String: Any],
                  let next = dictionary[String(key)]
            else {
                throw FreshnessError("tokens.json has nothing at \(path)")
            }
            current = next
        }
        guard let result = current as? [[String: Any]] else {
            throw FreshnessError("tokens.json's \(path) is not an array of objects")
        }
        return result
    }

    // MARK: Tests

    @Test("tokens.json is where the test expects it")
    func tokensFileExists() {
        #expect(
            FileManager.default.fileExists(atPath: Self.tokensURL.path),
            "expected tokens.json at \(Self.tokensURL.path)"
        )
    }

    @Test("ThemeTokens carries tokens.json's version and defaults")
    func versionAndDefaults() throws {
        let tokens = try Self.loadTokens()

        #expect(tokens["version"] as? String == ThemeTokens.tokensVersion)

        let defaults = try Self.object(tokens, at: "defaults")
        #expect(defaults["theme"] as? String == ThemeTokens.defaultTheme.rawValue)
        #expect(defaults["accentSlot"] as? Int == ThemeTokens.defaultAccentSlot)
        #expect(
            defaults["appearance"] as? String == ThemeTokens.defaultAppearance.rawValue
        )
    }

    @Test("The generator covers every theme, set, role and highlight key")
    func shapeMatches() throws {
        let tokens = try Self.loadTokens()

        let themes = try Self.object(tokens, at: "themes")
        #expect(
            Set(themes.keys) == Set(ThemeID.allCases.map(\.rawValue)),
            "tokens.json themes \(Set(themes.keys)) vs ThemeID \(ThemeID.allCases)"
        )

        #expect(tokens["modes"] as? [String] == ThemeSet.allCases.map(\.rawValue))
        #expect(tokens["roles"] as? [String] == ThemeRole.allCases.map(\.rawValue))

        let families = try Self.array(tokens, at: "highlightFamilies")
        #expect(
            families.compactMap { $0["key"] as? String }
                == HighlightKey.allCases.map(\.rawValue),
            "highlightFamilies must stay in the documented display order"
        )
    }

    @Test("Every role hex matches tokens.json", arguments: ThemeID.allCases)
    func rolesMatch(theme: ThemeID) throws {
        let tokens = try Self.loadTokens()
        let palette = ThemeTokens.palette(theme)

        let name = try Self.object(tokens, at: "themes.\(theme.rawValue)")["name"] as? String
        #expect(name == palette.name)

        for set in ThemeSet.allCases {
            let path = "themes.\(theme.rawValue).modes.\(set.rawValue)"
            let json = try Self.object(tokens, at: path)
            let roles = palette.roles(for: set)

            for role in ThemeRole.allCases {
                let expected = json[role.rawValue] as? String
                let actual = roles[role].hexString
                #expect(
                    expected == actual,
                    """
                    \(path).\(role.rawValue): tokens.json \(expected ?? "nil") \
                    vs ThemeTokens \(actual)
                    """
                )
            }
        }
    }

    @Test("Every highlight hex, name and spoken name matches tokens.json",
          arguments: ThemeID.allCases)
    func highlightsMatch(theme: ThemeID) throws {
        let tokens = try Self.loadTokens()
        let palette = ThemeTokens.palette(theme)

        for set in ThemeSet.allCases {
            let path = "themes.\(theme.rawValue).modes.\(set.rawValue).highlights"
            let json = try Self.array(tokens, at: path)
            let highlights = palette.roles(for: set).highlights

            #expect(json.count == highlights.count)
            #expect(highlights.count == HighlightKey.allCases.count)

            for (index, expected) in json.enumerated() {
                let actual = highlights[index]
                // Order is the display order, and the key is the identity (§7).
                #expect(expected["key"] as? String == actual.key.rawValue, "\(path)[\(index)] key")
                #expect(expected["hex"] as? String == actual.color.hexString, "\(path)[\(index)] hex")
                #expect(expected["name"] as? String == actual.name, "\(path)[\(index)] name")
                #expect(
                    expected["spokenName"] as? String == actual.spokenName,
                    "\(path)[\(index)] spokenName"
                )
            }
        }
    }

    @Test("Every accent slot, name, hex and onAccent matches tokens.json",
          arguments: ThemeID.allCases)
    func accentsMatch(theme: ThemeID) throws {
        let tokens = try Self.loadTokens()
        let palette = ThemeTokens.palette(theme)

        let path = "themes.\(theme.rawValue).accents.slots"
        let json = try Self.array(tokens, at: path)
        #expect(json.count == 6)
        #expect(palette.accentSlots.count == 6)

        for expected in json {
            guard let number = expected["slot"] as? Int else {
                throw FreshnessError("\(path): a slot has no number")
            }
            let actual = palette.accentSlot(number)
            #expect(actual.slot == number)
            #expect(expected["name"] as? String == actual.name, "\(path) slot \(number) name")

            let modes = try Self.object(expected, at: "modes")
            for set in ThemeSet.allCases {
                guard let mode = modes[set.rawValue] as? [String: Any] else {
                    throw FreshnessError("\(path) slot \(number) has no \(set.rawValue)")
                }
                let value = actual.value(for: set)
                #expect(
                    mode["hex"] as? String == value.color.hexString,
                    "\(path) slot \(number) \(set.rawValue) hex"
                )
                #expect(
                    mode["onAccent"] as? String == value.onAccent.hexString,
                    "\(path) slot \(number) \(set.rawValue) onAccent"
                )
            }
        }
    }

    /// The two `material3` values the generator does carry over, because they
    /// are the file's only non-opaque colours (themes-spec.md §2, §9).
    @Test("The generated scrims match tokens.json's material3 scrims",
          arguments: ThemeID.allCases)
    func scrimsMatch(theme: ThemeID) throws {
        let tokens = try Self.loadTokens()
        let palette = ThemeTokens.palette(theme)

        for set in ThemeSet.allCases {
            let path = "themes.\(theme.rawValue).material3.\(set.rawValue)"
            let json = try Self.object(tokens, at: path)
            let roles = palette.roles(for: set)

            for key in ["scrim", "scrimWarm"] {
                guard let spelling = json[key] as? String else {
                    throw FreshnessError("\(path).\(key) is missing")
                }
                let expected = try Self.parseRGBA(spelling, at: "\(path).\(key)")
                let actual = key == "scrim" ? roles.scrim : roles.scrimWarm

                #expect(expected.red == actual.red, "\(path).\(key) red")
                #expect(expected.green == actual.green, "\(path).\(key) green")
                #expect(expected.blue == actual.blue, "\(path).\(key) blue")
                #expect(
                    abs(expected.alpha - actual.alpha) < 1e-9,
                    "\(path).\(key) alpha: \(spelling) vs \(actual.alpha)"
                )
            }
        }
    }

    /// `rgba(31,26,20,0.45)` -> components. Compared numerically so the test
    /// does not also assert how a float prints.
    private static func parseRGBA(
        _ text: String,
        at path: String
    ) throws -> (red: Int, green: Int, blue: Int, alpha: Double) {
        guard text.hasPrefix("rgba("), text.hasSuffix(")") else {
            throw FreshnessError("\(path): \(text) is not an rgba() value")
        }
        let body = text.dropFirst("rgba(".count).dropLast()
        let parts = body.split(separator: ",")
        guard parts.count == 4,
              let red = Int(parts[0]),
              let green = Int(parts[1]),
              let blue = Int(parts[2]),
              let alpha = Double(parts[3])
        else {
            throw FreshnessError("\(path): \(text) has unreadable components")
        }
        return (red, green, blue, alpha)
    }
}
