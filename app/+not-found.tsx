/*
 * @Description: 
 */

import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { rs, rf } from '@/constants/scale';

import { JT_FONT } from '@/constants/jt';
export default function NotFoundScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={['#0a0a0a', '#1a1a1a']}
        style={StyleSheet.absoluteFillObject}
      />
      
      <View style={styles.content}>
        <MaterialIcons name="photo-camera" size={80} color="#FFD700" />
        <Text style={styles.title}>Page Not Found</Text>
        <Text style={styles.message}>
          The moment you are looking for seems to have been lost in the shadows.
        </Text>
        
        <TouchableOpacity 
          style={styles.homeButton}
          onPress={() => router.push('/')}
        >
          <Text style={styles.homeButtonText}>Return Home</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: rs(20),
  },
  title: {
    fontSize: rf(28),
    fontFamily: JT_FONT.bold,
    color: '#FFFFFF',
    marginTop: rs(20),
    marginBottom: rs(10),
  },
  message: {
    fontFamily: JT_FONT.medium, fontSize: rf(16),
    color: '#CCCCCC',
    textAlign: 'center',
    marginBottom: rs(40),
    lineHeight: rf(22),
  },
  homeButton: {
    backgroundColor: '#FFD700',
    paddingHorizontal: rs(30),
    paddingVertical: rs(15),
    borderRadius: rs(25),
  },
  homeButtonText: {
    color: '#0a0a0a',
    fontFamily: JT_FONT.bold,
    fontSize: rf(16),
  },
});
