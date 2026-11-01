/// A back/forward stack, as a plain value type.
///
/// There is always a `current` element, so the history can never be empty.
/// `visit` pushes the old current onto the back stack and clears the forward
/// stack, the way a browser does. `goBack` and `goForward` move between the
/// stacks without recording a new hop.
public struct NavigationHistory<Element: Equatable>: Equatable {
    private var backStack: [Element]
    private var forwardStack: [Element]

    /// Where the history sits right now.
    public private(set) var current: Element

    public init(_ current: Element) {
        self.current = current
        backStack = []
        forwardStack = []
    }

    public var canGoBack: Bool { !backStack.isEmpty }
    public var canGoForward: Bool { !forwardStack.isEmpty }

    /// Everything behind `current`, oldest first.
    public var back: [Element] { backStack }
    /// Everything ahead of `current`, nearest first.
    public var forward: [Element] { forwardStack.reversed() }

    /// Move to `element` and record the hop. Revisiting `current` does nothing,
    /// so repeated selections of the same place don't pile up.
    public mutating func visit(_ element: Element) {
        guard element != current else { return }
        backStack.append(current)
        forwardStack.removeAll()
        current = element
    }

    /// Step back one hop. Returns the new `current`, or nil if there is none.
    @discardableResult
    public mutating func goBack() -> Element? {
        guard let previous = backStack.popLast() else { return nil }
        forwardStack.append(current)
        current = previous
        return current
    }

    /// Step forward one hop. Returns the new `current`, or nil if there is none.
    @discardableResult
    public mutating func goForward() -> Element? {
        guard let next = forwardStack.popLast() else { return nil }
        backStack.append(current)
        current = next
        return current
    }
}

extension NavigationHistory: Sendable where Element: Sendable {}
