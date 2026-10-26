import { useState } from "react";
import { Text, TextInput, View, StyleSheet } from "react-native";
const token =
  /(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:def|class|return|if|else|elif|for|while|in|import|from|public|private|static|void|int|float|double|char|bool|const|let|function|new|true|false|null|None|True|False|pass|include|using|namespace|auto|struct|break|continue)\b|\b\d+(?:\.\d+)?\b)/g;
export function CodeEditor({
  value,
  onChange,
  editable = true,
}: {
  value: string;
  onChange: (value: string) => void;
  editable?: boolean;
}) {
  const [offset, setOffset] = useState(0);
  const pieces = value.split(token);
  return (
    <View style={styles.frame}>
      <View style={styles.gutter}>
        <View style={{ transform: [{ translateY: -offset }] }}>
          {value.split("\n").map((_, index) => (
            <Text
              key={index}
              style={[styles.type, { color: "#7B7B7B", textAlign: "right" }]}
            >
              {index + 1}
            </Text>
          ))}
        </View>
      </View>
      <View style={{ flex: 1, overflow: "hidden" }}>
        <View
          pointerEvents="none"
          importantForAccessibility="no-hide-descendants"
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 0,
            padding: 14,
            transform: [{ translateY: -offset }],
          }}
        >
          <Text style={styles.type}>
            {pieces.map((part, index) => (
              <Text
                key={index}
                style={{
                  color: /^(\/\/|#|\/\*)/.test(part)
                    ? "#7CA982"
                    : /^["']/.test(part)
                      ? "#E7BF7D"
                      : /^\d/.test(part)
                        ? "#B69AE6"
                        : index % 2
                          ? "#7DC8E8"
                          : "#E7E7E7",
                }}
              >
                {part}
              </Text>
            ))}
            {"\n"}
          </Text>
        </View>
        <TextInput
          accessibilityLabel="Source code editor"
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          editable={editable}
          value={value}
          onChangeText={onChange}
          maxLength={30000}
          onScroll={(event) => setOffset(event.nativeEvent.contentOffset.y)}
          selectionColor="#A1D7C8"
          cursorColor="#A1D7C8"
          style={[
            styles.type,
            {
              flex: 1,
              color: "transparent",
              padding: 14,
              textAlignVertical: "top",
              backgroundColor: "transparent",
            },
          ]}
        />
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  frame: {
    flexDirection: "row",
    height: 370,
    borderWidth: 1,
    borderColor: "#454545",
    backgroundColor: "#212121",
    borderRadius: 8,
    overflow: "hidden",
  },
  gutter: {
    width: 37,
    paddingTop: 14,
    paddingRight: 8,
    backgroundColor: "#292929",
    overflow: "hidden",
  },
  type: {
    fontFamily: "monospace",
    fontSize: 13,
    lineHeight: 21,
    includeFontPadding: false,
    color: "#E7E7E7",
  },
});
