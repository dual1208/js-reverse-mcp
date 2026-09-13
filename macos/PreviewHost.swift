// A temporary regular-window host for verifying the exact menu tree with native
// accessibility tools that cannot select LSUIElement-only applications.
import SwiftUI

@main
struct PreviewHost: App {
    @State private var model = ManagerModel()

    var body: some Scene {
        WindowGroup("JS-Reverse UI Verification") {
            TreeView(model: model).task { model.start() }
        }
        .windowResizability(.contentSize)
    }
}
