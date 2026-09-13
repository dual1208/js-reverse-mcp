import Foundation

struct ManagerSnapshot: Decodable, Sendable {
    let profiles: [BrowserProfile]
}

struct BrowserProfile: Decodable, Identifiable, Sendable {
    let id: String
    let userDataDir: String
    let running: Bool
    let instances: [ReverseInstance]
}

struct ReverseInstance: Decodable, Identifiable, Sendable {
    let id: String
    let harness: String
    let conversation: String
    let label: String
    let status: String
    let reason: String?
    let connectionCount: Int
    let sessions: [DebugSession]
}

struct DebugSession: Decodable, Identifiable, Sendable {
    let id: String
    let sessionId: String
    let parentSessionId: String?
    let targetId: String
    let type: String
    let title: String
    let url: String
}

struct ManagerLocation: Decodable {
    let stateDir: String
}

struct ManagerEndpoint: Decodable {
    let url: URL
    let token: String
}
