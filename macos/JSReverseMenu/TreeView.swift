import SwiftUI

struct TreeView: View {
    let model: ManagerModel

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Label("JS-Reverse", systemImage: "point.3.connected.trianglepath.dotted")
                    .font(.headline)
                Spacer()
                Text("\(model.activeCount) connected").foregroundStyle(.secondary)
                Button("Refresh", systemImage: "arrow.clockwise") {
                    Task { await model.refresh() }
                }.labelStyle(.iconOnly)
            }
            if let error = model.error {
                Text(error).foregroundStyle(.red).textSelection(.enabled)
            }
            if let error = model.operationError {
                Text(error).foregroundStyle(.orange).textSelection(.enabled)
            }
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    ForEach(model.profiles) { profile in
                        ProfileRow(profile: profile, model: model)
                    }
                }.frame(maxWidth: .infinity, alignment: .leading)
            }
            Divider()
            Text("Disconnect ends one instance. Chrome and its tabs stay open. Detach removes one CDP session and may interrupt that instance's tools.")
                .font(.caption).foregroundStyle(.secondary)
            Text("All sessions on managed JS-Reverse connections are shown. Direct CDP clients are outside this tree.")
                .font(.caption).foregroundStyle(.secondary)
        }
        .padding(16)
        .frame(width: 680, height: 720)
    }
}

private struct ProfileRow: View {
    let profile: BrowserProfile
    let model: ManagerModel
    @State private var expanded = true

    var body: some View {
        DisclosureGroup(isExpanded: $expanded) {
            VStack(alignment: .leading, spacing: 12) {
                if profile.instances.isEmpty {
                    Text("No JS-Reverse instances").foregroundStyle(.secondary)
                }
                ForEach(profile.instances) { instance in
                    InstanceRow(instance: instance, model: model)
                }
            }.frame(maxWidth: .infinity, alignment: .leading).padding(.leading, 12).padding(.top, 8)
        } label: {
            HStack {
                Label(profile.id.capitalized, systemImage: "person.crop.circle")
                    .font(.title3.weight(.semibold))
                Text(profile.running ? "Chrome running" : "Chrome offline")
                    .font(.caption).foregroundStyle(profile.running ? .green : .secondary)
                Spacer()
                Text("\(profile.instances.count) instances").foregroundStyle(.secondary)
            }.help(profile.userDataDir)
        }
    }
}

private struct InstanceRow: View {
    let instance: ReverseInstance
    let model: ManagerModel
    @State private var expanded = true

    var body: some View {
        DisclosureGroup(isExpanded: $expanded) {
            VStack(alignment: .leading, spacing: 8) {
                Text("Conversation: \(instance.conversation)")
                    .font(.caption.monospaced()).foregroundStyle(.secondary).textSelection(.enabled)
                if let reason = instance.reason {
                    Text(reason).font(.caption).foregroundStyle(.secondary)
                }
                ForEach(instance.sessions) { session in
                    SessionRow(session: session, instanceID: instance.id, model: model)
                }
                if instance.sessions.isEmpty {
                    Text("No attached CDP sessions").font(.caption).foregroundStyle(.secondary)
                }
            }.frame(maxWidth: .infinity, alignment: .leading).padding(.leading, 12).padding(.top, 6)
        } label: {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("\(instance.harness) · \(instance.label)").fontWeight(.medium)
                    Text("\(instance.status) · \(instance.connectionCount) connections · \(instance.sessions.count) CDP sessions")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                if instance.status == "disconnected" {
                    Button("Remove") {
                        Task { await model.perform(id: instance.id, path: "instances/\(instance.id)", method: "DELETE") }
                    }.accessibilityLabel("Remove disconnected instance \(instance.label)")
                } else {
                    Button("Disconnect", role: .destructive) {
                        Task { await model.perform(id: instance.id, path: "instances/\(instance.id)/disconnect") }
                    }.accessibilityLabel("Disconnect \(instance.label)")
                }
            }.disabled(model.pending.contains(instance.id) || model.error != nil)
        }
    }
}

private struct SessionRow: View {
    let session: DebugSession
    let instanceID: String
    let model: ManagerModel

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "chevron.left.forwardslash.chevron.right")
                .foregroundStyle(.secondary).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text("\(session.type) · \(session.title.isEmpty ? session.targetId : session.title)")
                    .font(.callout)
                if !session.url.isEmpty {
                    Text(session.url).font(.caption).foregroundStyle(.secondary)
                }
                Text(session.sessionId).font(.caption2.monospaced()).textSelection(.enabled)
                if let parent = session.parentSessionId {
                    Text("Parent session: \(parent)").font(.caption2.monospaced()).foregroundStyle(.secondary)
                }
            }.frame(maxWidth: .infinity, alignment: .leading)
            Button("Detach", role: .destructive) {
                Task { await model.perform(id: session.id, path: "instances/\(instanceID)/sessions/\(session.id)/detach") }
            }
            .accessibilityLabel("Detach CDP session \(session.sessionId)")
            .disabled(model.pending.contains(session.id) || model.error != nil)
        }
        .padding(8)
        .background(.quaternary, in: RoundedRectangle(cornerRadius: 6))
    }
}
