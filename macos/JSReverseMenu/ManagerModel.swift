import Foundation
import Observation

@MainActor @Observable
final class ManagerModel {
    var profiles: [BrowserProfile] = []
    var error: String?
    var operationError: String?
    var pending: Set<String> = []
    private var polling: Task<Void, Never>?

    var activeCount: Int {
        profiles.flatMap(\.instances).filter { $0.status == "connected" }.count
    }

    func start() {
        guard polling == nil else { return }
        polling = Task { [weak self] in
            while !Task.isCancelled {
                await self?.refresh()
                try? await Task.sleep(for: .seconds(2))
            }
        }
    }

    func refresh() async {
        do {
            let data = try await request(path: "state")
            profiles = try JSONDecoder().decode(ManagerSnapshot.self, from: data).profiles
            error = nil
        } catch {
            self.error = "Manager unavailable: \(error.localizedDescription)"
        }
    }

    func perform(id: String, path: String, method: String = "POST") async {
        guard !pending.contains(id) else { return }
        pending.insert(id)
        defer { pending.remove(id) }
        do {
            _ = try await request(path: path, method: method)
            operationError = nil
        } catch {
            operationError = error.localizedDescription
        }
        await refresh()
    }

    private func request(path: String, method: String = "GET") async throws -> Data {
        let configPath = ProcessInfo.processInfo.environment["JS_REVERSE_MANAGER_CONFIG"] ??
            FileManager.default.homeDirectoryForCurrentUser.appending(path: ".config/js-reverse-manager/config.json").path
        let location = try JSONDecoder().decode(ManagerLocation.self, from: Data(contentsOf: URL(filePath: configPath)))
        let endpoint = try JSONDecoder().decode(ManagerEndpoint.self, from: Data(contentsOf: URL(filePath: location.stateDir).appending(path: "manager.json")))
        guard endpoint.url.scheme == "http", endpoint.url.host() == "127.0.0.1" else {
            throw URLError(.badURL)
        }
        var request = URLRequest(url: endpoint.url.appending(path: path))
        request.httpMethod = method
        request.timeoutInterval = 8
        request.setValue("Bearer \(endpoint.token)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let message = (try? JSONSerialization.jsonObject(with: data) as? [String: String])?["error"] ?? "Manager operation failed"
            throw NSError(domain: "JSReverse", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
        }
        return data
    }
}
