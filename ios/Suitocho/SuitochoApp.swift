import SwiftUI
import SwiftData

@main
struct SuitochoApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
        .modelContainer(for: Entry.self)
    }
}
