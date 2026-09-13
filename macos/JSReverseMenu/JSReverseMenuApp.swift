import SwiftUI

@main
struct JSReverseMenuApp: App {
    @State private var model = ManagerModel()

    var body: some Scene {
        MenuBarExtra {
            TreeView(model: model)
        } label: {
            Label("JSR \(model.activeCount)", systemImage: "point.3.connected.trianglepath.dotted")
                .task { model.start() }
        }
        .menuBarExtraStyle(.window)
    }
}
