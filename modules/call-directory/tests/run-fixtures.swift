import Foundation

/**
 Runs `fixtures/matching.json` through the engine that ships on iOS.

 Built and run on its own, without Xcode:

   swiftc -O modules/call-directory/ios/RuleEngine.swift modules/call-directory/tests/run-fixtures.swift -o /tmp/cd-fixtures
   /tmp/cd-fixtures fixtures/matching.json
 */
@main
struct FixtureRunner {
  static func main() {
    let arguments = CommandLine.arguments.dropFirst()
    guard let path = arguments.first else {
      FileHandle.standardError.write(Data("usage: run-fixtures <path to matching.json>\n".utf8))
      exit(2)
    }

    let json: String
    do {
      json = try String(contentsOfFile: path, encoding: .utf8)
    } catch {
      FileHandle.standardError.write(Data("cannot read \(path): \(error)\n".utf8))
      exit(2)
    }

    let failures = fixtureFailures(json)
    guard failures.isEmpty else {
      for failure in failures {
        print("FAIL \(failure)")
      }
      exit(1)
    }

    print("PASS \(caseCount(in: json))")
  }

  private static func caseCount(in json: String) -> Int {
    guard let object = try? JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any],
          let cases = object["cases"] as? [Any] else {
      return 0
    }
    return cases.count
  }
}
