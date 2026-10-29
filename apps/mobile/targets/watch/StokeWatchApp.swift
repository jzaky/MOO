import SwiftUI

private let accent = Color(red: 124 / 255, green: 240 / 255, blue: 180 / 255)

@main
struct StokeWatchApp: App {
  @StateObject private var session = WorkoutSession()

  var body: some Scene {
    WindowGroup {
      ContentView()
        .environmentObject(session)
        .tint(accent)
    }
  }
}

struct ContentView: View {
  @EnvironmentObject private var session: WorkoutSession

  var body: some View {
    if let state = session.state {
      WorkoutView(state: state, pending: session.pendingSetId != nil && session.pendingSetId == state.setId) {
        session.completeSet()
      }
    } else {
      VStack(spacing: 6) {
        Image(systemName: "flame.fill").foregroundColor(accent)
        Text("No workout").font(.headline)
        Text("Start one on your iPhone.")
          .font(.footnote)
          .foregroundColor(.secondary)
          .multilineTextAlignment(.center)
      }
    }
  }
}

struct WorkoutView: View {
  let state: WatchWorkoutState
  let pending: Bool
  let onComplete: () -> Void

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 6) {
        Text(state.exerciseName ?? state.workoutName)
          .font(.headline)
          .lineLimit(2)
        if let label = state.setLabel {
          Text(label).font(.footnote).foregroundColor(.secondary)
          Text(loadText).font(.title3.monospacedDigit()).bold()
        } else {
          Text("All sets done").font(.footnote).foregroundColor(.secondary)
        }

        if let end = state.restEndDate {
          RestCountdown(end: end)
        }

        if state.setId != nil {
          Button(action: onComplete) {
            Label(pending ? "Sent" : "Complete set", systemImage: pending ? "checkmark.circle" : "checkmark")
          }
          .disabled(pending)
          .padding(.top, 4)
        }

        Text("\(state.completedSets)/\(state.totalSets) sets")
          .font(.caption2)
          .foregroundColor(.secondary)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
  }

  private var loadText: String {
    let reps = state.reps.map { formatNumber($0) } ?? "–"
    guard let kg = state.weightKg, kg > 0 else { return "\(reps) reps" }
    return "\(formatNumber(kg)) kg × \(reps)"
  }
}

/// Counts down to `end` once per second; shows "Rest done" afterwards.
struct RestCountdown: View {
  let end: Date

  var body: some View {
    TimelineView(.periodic(from: .now, by: 1)) { context in
      let left = Int(ceil(end.timeIntervalSince(context.date)))
      HStack(spacing: 4) {
        Image(systemName: "timer").foregroundColor(accent)
        if left > 0 {
          Text(String(format: "%d:%02d", left / 60, left % 60))
            .font(.title2.monospacedDigit())
            .foregroundColor(accent)
        } else {
          Text("Rest done").font(.headline).foregroundColor(accent)
        }
      }
    }
  }
}

private func formatNumber(_ value: Double) -> String {
  value.rounded() == value ? String(Int(value)) : String(format: "%.1f", value)
}
