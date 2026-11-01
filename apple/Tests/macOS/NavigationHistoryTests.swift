import CupertinoUI
import Testing

@Suite("NavigationHistory")
struct NavigationHistoryTests {
    @Test("A fresh history sits on its start value and goes nowhere")
    func freshHistory() {
        let history = NavigationHistory("read")
        #expect(history.current == "read")
        #expect(!history.canGoBack)
        #expect(!history.canGoForward)
        #expect(history.back.isEmpty)
        #expect(history.forward.isEmpty)
    }

    @Test("Visiting records the hop and only opens the back direction")
    func visitRecords() {
        var history = NavigationHistory("read")
        history.visit("notes")

        #expect(history.current == "notes")
        #expect(history.canGoBack)
        #expect(!history.canGoForward)
        #expect(history.back == ["read"])
    }

    @Test("Revisiting the current value is a no-op")
    func revisitingCurrentDoesNothing() {
        var history = NavigationHistory("read")
        history.visit("read")

        #expect(!history.canGoBack)
        #expect(history.back.isEmpty)
    }

    @Test("Back and forward walk the same path without recording")
    func backAndForwardWalk() {
        var history = NavigationHistory("read")
        history.visit("studyspace")
        history.visit("notes")

        #expect(history.goBack() == "studyspace")
        #expect(history.current == "studyspace")
        #expect(history.canGoForward)
        #expect(history.forward == ["notes"])

        #expect(history.goBack() == "read")
        #expect(!history.canGoBack)
        #expect(history.forward == ["studyspace", "notes"])

        #expect(history.goForward() == "studyspace")
        #expect(history.goForward() == "notes")
        #expect(!history.canGoForward)
        #expect(history.back == ["read", "studyspace"])
    }

    @Test("Going past either end returns nil and changes nothing")
    func pastTheEnds() {
        var history = NavigationHistory("read")

        #expect(history.goBack() == nil)
        #expect(history.goForward() == nil)
        #expect(history.current == "read")

        history.visit("library")
        #expect(history.goForward() == nil)
        #expect(history.current == "library")
    }

    @Test("Visiting after a back drops everything ahead")
    func visitTruncatesForward() {
        var history = NavigationHistory("read")
        history.visit("studyspace")
        history.visit("notes")
        history.goBack()

        history.visit("library")

        #expect(history.current == "library")
        #expect(!history.canGoForward)
        #expect(history.back == ["read", "studyspace"])
    }

    @Test("The same value can appear more than once in the path")
    func repeatedValues() {
        var history = NavigationHistory(1)
        history.visit(2)
        history.visit(1)
        history.visit(2)

        #expect(history.back == [1, 2, 1])
        #expect(history.goBack() == 1)
        #expect(history.goBack() == 2)
        #expect(history.goBack() == 1)
        #expect(!history.canGoBack)
    }

    @Test("It is a value type: copies don't share state")
    func copiesAreIndependent() {
        var original = NavigationHistory("read")
        original.visit("notes")

        var copy = original
        copy.goBack()

        #expect(original.current == "notes")
        #expect(copy.current == "read")
    }
}
