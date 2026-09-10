// ============================================================================
// Registration screen — ElderCare
//
// Simple, accessible registration flow tailored for elderly, family, and caregiver users.
// Allows users to select their account type ('elderly', 'family', 'caregiver').
// Handover to AuthContext.signIn() on success, which stores tokens and
// triggers role-based routing automatically.
// ============================================================================

import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { register } from '../api/auth';
import { useAuth } from '../auth/AuthContext';
import { colors, spacing, type } from '../ui/theme';

const ROLE_OPTIONS = [
  {
    key: 'elderly',
    label: 'Elderly User',
    description: 'For seniors using ElderCare for emergency help & safety',
    icon: '👴',
  },
  {
    key: 'family',
    label: 'Family Member',
    description: 'For family members supporting & monitoring an elderly relative',
    icon: '👨‍👩‍👧',
  },
  {
    key: 'caregiver',
    label: 'Professional Caregiver',
    description: 'For professional caregivers delivering assistance & care plans',
    icon: '🩺',
  },
];

export function RegisterScreen({ navigation }) {
  const { signIn } = useAuth();

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [selectedRole, setSelectedRole] = useState(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});

  function validate() {
    const errs = {};
    if (!fullName.trim()) {
      errs.fullName = 'Please enter your full name.';
    }
    if (!phone.trim()) {
      errs.phone = 'Please enter your phone number.';
    }
    if (!selectedRole) {
      errs.role = 'Please select an account type.';
    }
    if (!password) {
      errs.password = 'Please enter a password.';
    } else if (password.length < 8) {
      errs.password = 'Password must be at least 8 characters.';
    }
    if (password !== confirmPassword) {
      errs.confirmPassword = 'Passwords do not match.';
    }

    if (email.trim()) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
      if (!emailRegex.test(email.trim())) {
        errs.email = 'Please enter a valid email address.';
      }
    }

    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleRegister() {
    setError(null);
    setFieldErrors({});

    if (!validate()) {
      return;
    }

    setBusy(true);

    try {
      const payload = {
        fullName: fullName.trim(),
        phone: phone.trim(),
        password,
        role: selectedRole,
      };

      if (email.trim()) {
        payload.email = email.trim();
      }

      const response = await register(payload);
      await signIn(response);
    } catch (err) {
      if (err.name === 'NetworkError') {
        setError('Unable to connect to the server. Please check your connection and try again.');
      } else if (err.code === 'account_exists') {
        setError('An account with this phone number or email already exists.');
      } else if (err.code === 'role_not_self_assignable') {
        setError('The selected role is not permitted for public registration.');
      } else if (err.code === 'validation_failed' && Array.isArray(err.details)) {
        const mappedErrs = {};
        err.details.forEach((item) => {
          if (item.field) mappedErrs[item.field] = item.message;
        });
        setFieldErrors(mappedErrs);
        setError('Please fix the errors below.');
      } else {
        setError(err.message || 'Registration failed. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.brandTitle}>ElderCare</Text>
            <Text style={styles.headerTitle}>Create Account</Text>
            <Text style={styles.subtitle}>Register to get started with ElderCare</Text>
          </View>

          {/* Global Error Notice */}
          {error ? (
            <View style={styles.errorBanner} accessibilityRole="alert">
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {/* Form */}
          <View style={styles.form}>
            {/* Full Name */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Full Name *</Text>
              <TextInput
                style={[styles.input, fieldErrors.fullName ? styles.inputError : null]}
                value={fullName}
                onChangeText={setFullName}
                placeholder="Enter your full name"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="words"
                autoCorrect={false}
                accessibilityLabel="Full Name"
              />
              {fieldErrors.fullName ? (
                <Text style={styles.fieldErrorText}>{fieldErrors.fullName}</Text>
              ) : null}
            </View>

            {/* Phone Number */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Phone Number *</Text>
              <View style={styles.phoneInputContainer}>
                <View style={styles.countryBadge}>
                  <Text style={styles.countryCode}>+91</Text>
                </View>
                <TextInput
                  style={[
                    styles.input,
                    styles.phoneInput,
                    fieldErrors.phone ? styles.inputError : null,
                  ]}
                  value={phone}
                  onChangeText={setPhone}
                  placeholder="10-digit mobile number"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="phone-pad"
                  autoCapitalize="none"
                  autoCorrect={false}
                  accessibilityLabel="Phone number"
                />
              </View>
              {fieldErrors.phone ? (
                <Text style={styles.fieldErrorText}>{fieldErrors.phone}</Text>
              ) : null}
            </View>

            {/* Email Address (Optional) */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Email Address (Optional)</Text>
              <TextInput
                style={[styles.input, fieldErrors.email ? styles.inputError : null]}
                value={email}
                onChangeText={setEmail}
                placeholder="e.g. name@example.com"
                placeholderTextColor={colors.textMuted}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                accessibilityLabel="Email address optional"
              />
              {fieldErrors.email ? (
                <Text style={styles.fieldErrorText}>{fieldErrors.email}</Text>
              ) : null}
            </View>

            {/* Account Type / Role Selector */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Account Type *</Text>
              <Text style={styles.roleSubtext}>Select the role that best describes how you will use ElderCare:</Text>

              <View style={styles.roleSelectorList} accessibilityRole="radiogroup" accessibilityLabel="Account Type Selection">
                {ROLE_OPTIONS.map((option) => {
                  const isSelected = selectedRole === option.key;
                  return (
                    <Pressable
                      key={option.key}
                      style={({ pressed }) => [
                        styles.roleOptionCard,
                        isSelected && styles.roleOptionCardSelected,
                        pressed && styles.roleOptionCardPressed,
                      ]}
                      onPress={() => setSelectedRole(option.key)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: isSelected }}
                      accessibilityLabel={`${option.label}. ${option.description}`}
                    >
                      <View style={styles.roleCardIconBox}>
                        <Text style={styles.roleCardIcon}>{option.icon}</Text>
                      </View>
                      <View style={styles.roleCardContent}>
                        <Text style={[styles.roleCardTitle, isSelected && styles.roleCardTitleSelected]}>
                          {option.label}
                        </Text>
                        <Text style={styles.roleCardDesc}>{option.description}</Text>
                      </View>
                      <View style={[styles.radioButton, isSelected && styles.radioButtonSelected]}>
                        {isSelected ? <View style={styles.radioButtonInner} /> : null}
                      </View>
                    </Pressable>
                  );
                })}
              </View>
              {fieldErrors.role ? (
                <Text style={styles.fieldErrorText}>{fieldErrors.role}</Text>
              ) : null}
            </View>

            {/* Password */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Password * (Min. 8 characters)</Text>
              <View style={styles.passwordContainer}>
                <TextInput
                  style={[
                    styles.input,
                    styles.passwordInput,
                    fieldErrors.password ? styles.inputError : null,
                  ]}
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Create a password"
                  placeholderTextColor={colors.textMuted}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  accessibilityLabel="Password"
                />
                <Pressable
                  style={styles.showButton}
                  onPress={() => setShowPassword((prev) => !prev)}
                  accessibilityRole="button"
                  accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                >
                  <Text style={styles.showButtonText}>{showPassword ? 'Hide' : 'Show'}</Text>
                </Pressable>
              </View>
              {fieldErrors.password ? (
                <Text style={styles.fieldErrorText}>{fieldErrors.password}</Text>
              ) : null}
            </View>

            {/* Confirm Password */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Confirm Password *</Text>
              <View style={styles.passwordContainer}>
                <TextInput
                  style={[
                    styles.input,
                    styles.passwordInput,
                    fieldErrors.confirmPassword ? styles.inputError : null,
                  ]}
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  placeholder="Re-enter your password"
                  placeholderTextColor={colors.textMuted}
                  secureTextEntry={!showConfirmPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  accessibilityLabel="Confirm password"
                />
                <Pressable
                  style={styles.showButton}
                  onPress={() => setShowConfirmPassword((prev) => !prev)}
                  accessibilityRole="button"
                  accessibilityLabel={
                    showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'
                  }
                >
                  <Text style={styles.showButtonText}>{showConfirmPassword ? 'Hide' : 'Show'}</Text>
                </Pressable>
              </View>
              {fieldErrors.confirmPassword ? (
                <Text style={styles.fieldErrorText}>{fieldErrors.confirmPassword}</Text>
              ) : null}
            </View>

            {/* Submit Button */}
            <Pressable
              style={({ pressed }) => [
                styles.submitButton,
                pressed && styles.submitButtonPressed,
                (busy || !selectedRole) && styles.submitButtonDisabled,
              ]}
              onPress={handleRegister}
              disabled={busy || !selectedRole}
              accessibilityRole="button"
              accessibilityLabel="Create account"
            >
              {busy ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.submitButtonText}>Create Account</Text>
              )}
            </Pressable>
          </View>

          {/* Footer Link */}
          <View style={styles.footer}>
            <Text style={styles.footerText}>Already have an account? </Text>
            <Pressable
              onPress={() => navigation.navigate('Login')}
              accessibilityRole="button"
              accessibilityLabel="Sign in to existing account"
            >
              <Text style={styles.loginLink}>Sign In</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  fill: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
    justifyContent: 'center',
    minHeight: '100%',
  },
  header: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  brandTitle: {
    fontSize: type.title + 6,
    fontWeight: '900',
    color: colors.primary,
    letterSpacing: -0.5,
    marginBottom: spacing.xs,
  },
  headerTitle: {
    fontSize: type.heading,
    fontWeight: '800',
    color: colors.text,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: type.body - 1,
    color: colors.textMuted,
    textAlign: 'center',
  },
  errorBanner: {
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  errorText: {
    color: colors.danger,
    fontSize: type.body - 1,
    fontWeight: '600',
    textAlign: 'center',
  },
  form: {
    gap: spacing.lg,
  },
  inputGroup: {
    gap: spacing.xs,
  },
  label: {
    fontSize: type.body - 1,
    fontWeight: '700',
    color: colors.text,
  },
  roleSubtext: {
    fontSize: type.small,
    color: colors.textMuted,
    marginBottom: 4,
  },
  roleSelectorList: {
    gap: spacing.sm,
    marginTop: 4,
  },
  roleOptionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 14,
    padding: spacing.md,
    gap: spacing.md,
  },
  roleOptionCardSelected: {
    borderColor: colors.primary,
    backgroundColor: '#EFF6FF',
  },
  roleOptionCardPressed: {
    backgroundColor: '#DBEAFE',
  },
  roleCardIconBox: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleCardIcon: {
    fontSize: 22,
  },
  roleCardContent: {
    flex: 1,
  },
  roleCardTitle: {
    fontSize: type.body,
    fontWeight: '800',
    color: colors.text,
    marginBottom: 2,
  },
  roleCardTitleSelected: {
    color: colors.primary,
  },
  roleCardDesc: {
    fontSize: type.small,
    color: colors.textMuted,
    lineHeight: 18,
  },
  radioButton: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioButtonSelected: {
    borderColor: colors.primary,
  },
  radioButtonInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.primary,
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    fontSize: type.body,
    color: colors.text,
  },
  inputError: {
    borderColor: colors.danger,
  },
  fieldErrorText: {
    color: colors.danger,
    fontSize: type.small,
    fontWeight: '600',
  },
  phoneInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  countryBadge: {
    backgroundColor: '#F3F4F6',
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  countryCode: {
    fontSize: type.body,
    fontWeight: '700',
    color: colors.text,
  },
  phoneInput: {
    flex: 1,
  },
  passwordContainer: {
    position: 'relative',
    justifyContent: 'center',
  },
  passwordInput: {
    paddingRight: 64,
  },
  showButton: {
    position: 'absolute',
    right: spacing.md,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  showButtonText: {
    fontSize: type.body - 1,
    fontWeight: '700',
    color: colors.primary,
  },
  submitButton: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  submitButtonPressed: {
    backgroundColor: '#1D4ED8',
  },
  submitButtonDisabled: {
    opacity: 0.7,
  },
  submitButtonText: {
    color: '#FFFFFF',
    fontSize: type.body + 1,
    fontWeight: '800',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  footerText: {
    fontSize: type.body - 1,
    color: colors.textMuted,
  },
  loginLink: {
    fontSize: type.body - 1,
    fontWeight: '800',
    color: colors.primary,
  },
});
