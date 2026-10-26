import { useState } from "react";
import { Image, View, Pressable, Modal, Text } from "react-native";
import type { LessonQuestion } from "@slate/contracts";
import { usePage } from "../lib/session";
import { State, Label, Icon, IconButton, s, Card } from "./ui";
import { colors } from "../theme";
export function QuestionImage({
  question,
  path,
}: {
  question: LessonQuestion;
  path: string;
}) {
  const [expanded, setExpanded] = useState(false),
    url = usePage<{ url: string }>(path, Boolean(question.image));
  if (!question.image) return null;
  return (
    <>
      <State
        pending={url.isPending}
        error={url.error}
        onRetry={() => void url.refetch()}
      />
      {url.data && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Enlarge: ${question.image.alt}`}
          onPress={() => setExpanded(true)}
        >
          <Image
            source={{ uri: url.data.url }}
            accessibilityLabel={question.image.alt}
            resizeMode="contain"
            style={{ height: 210, width: "100%", borderRadius: 8 }}
          />
        </Pressable>
      )}
      <Modal visible={expanded} onRequestClose={() => setExpanded(false)}>
        <View style={{ flex: 1, backgroundColor: "#fff", paddingTop: 35 }}>
          <IconButton
            name="x"
            label="Close image"
            onPress={() => setExpanded(false)}
          />
          <Image
            source={{ uri: url.data?.url }}
            resizeMode="contain"
            style={{ flex: 1 }}
          />
        </View>
      </Modal>
    </>
  );
}
export function Choices({
  question,
  value,
  onChange,
  imagePath,
}: {
  question: LessonQuestion;
  value?: number;
  onChange: (value: number) => void;
  imagePath: string;
}) {
  return (
    <View style={{ gap: 12 }}>
      <Label style={{ fontSize: 18, fontWeight: "700", lineHeight: 27 }}>
        {question.prompt}
      </Label>
      {question.image && <QuestionImage question={question} path={imagePath} />}{" "}
      {question.options.map((option, index) => (
        <Pressable
          key={index}
          accessibilityRole="radio"
          accessibilityState={{ checked: value === index }}
          onPress={() => onChange(index)}
          style={[
            s.card,
            s.row,
            { minHeight: 56 },
            value === index && {
              borderColor: colors.primary,
              backgroundColor: colors.primaryLight,
            },
          ]}
        >
          <Icon name={value === index ? "check-circle" : "circle"} size={21} />
          <Label style={{ flex: 1 }}>{option}</Label>
        </Pressable>
      ))}
    </View>
  );
}
export function EmptyFeature() {
  return (
    <Card>
      <Icon name="lock" />
      <Label>
        This section has not been assigned to your account. Contact your
        organization for access.
      </Label>
    </Card>
  );
}
export function CourseArtwork({
  title,
  url,
}: {
  title: string;
  url?: string | null;
}) {
  return url ? (
    <Image
      source={{ uri: url }}
      style={{ height: 150, borderRadius: 10, width: "100%" }}
      resizeMode="cover"
      accessibilityLabel={`${title} course cover`}
    />
  ) : (
    <View
      style={{
        height: 120,
        backgroundColor: colors.primary,
        borderRadius: 10,
        padding: 20,
        justifyContent: "space-between",
      }}
    >
      <Icon name="book-open" color="#BFD4F4" size={30} />
      <Text
        style={{ fontSize: 25, color: "#fff", fontWeight: "700" }}
        numberOfLines={2}
      >
        {title}
      </Text>
    </View>
  );
}
