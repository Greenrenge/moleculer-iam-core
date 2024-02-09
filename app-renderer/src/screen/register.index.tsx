import React, { useState, useMemo } from "react";
import { ScreenLayout, Text, FormInput, Icon } from "../component";
import { useNavigation, useAppState, useWithLoading, useAppOptions, useAppI18N } from "../hook";
import {
  Field, FieldProps, Form, Formik, FormikProps,
} from "formik";
import * as yup from "yup";

export const RegisterIndexScreen: React.FunctionComponent = () => {
  // state
  const { formatMessage: f } = useAppI18N();
  const [state, dispatch] = useAppState();
  const [options] = useAppOptions();
  const tmpState = state.session.register || {};
  const tmpClaims = tmpState.claims || {};
  const tmpCreds = tmpState.credentials || {};
  const [payload, setPayload] = useState({
    name: tmpClaims.name || "",
    email: tmpClaims.email || "",
    password: tmpCreds.password || "",
    password_confirmation: tmpCreds.password_confirmation || "",
  });

  const payloadLabels = {
    claims: {
      name: f({id: "payload.name"}),
      email: f({id: "payload.email"}),
    },
    credentials: {
      password: f({id: "payload.password"}),
      password_confirmation: f({id: "payload.passwordConfirmation"}),
    },
  };

  const emailVerified = state.session.verifyEmail && state.session.verifyEmail.email === payload.email && state.session.verifyEmail.verified;

  // handlers
  const { nav } = useNavigation();
  const {loading, errors, setErrors, withLoading} = useWithLoading();
  const [handlePayloadSubmit, handlePayloadSubmitLoading] = withLoading(async () => {
    const { name, email, password, password_confirmation } = payload;
    const data = {
      submit: false,
      claims: {
        name,
        email,
      },
      credentials: {
        password,
        password_confirmation,
      },
      scope: ["email", "profile"],
    };

    return dispatch("register.submit", data, payloadLabels)
      .then((s) => {
        setErrors({});
        // set normalized email
        setPayload(p => ({ ...p, email: s.session.register.claims.email || "" }));

        // verify email
        if (!options.register.skipEmailVerification && !emailVerified) {
          return dispatch("verify_email.check_email", {
            email: data.claims.email,
            registered: false,
          })
            .then(() => {
              nav.navigate("verify_email.verify", {
                callback: "register",
              });
            });

        // enter detail claims
        } else if (!options.register.skipDetailClaims) {
          nav.navigate("register.detail");

        // register user
        } else {
          return dispatch("register.submit", {
            ...data,
            register: true,
          })
            .then(() => {
              nav.navigate("register.end");
            });
        }
      })
      .catch(errs => setErrors(errs));
  }, [payload]);

  const [handleCancel, handleCancelLoading] = withLoading(() => {
    nav.navigate("login.index");
    setErrors({});
  }, []);
  const userSchema = useMemo(() => yup.object().shape({
    name: yup.string().required(f({id: "register.validation.name"})).min(1, f({id: "register.validation.name"})).max(50, f({id: "register.validation.name"})),
    email: yup.string().email(f({id: "register.validation.email"})).required(f({id: "register.validation.email"})),
    password: yup.string().required(f({id: "register.validation.password"})).min(8, f({id: "register.validation.password"})).max(32, f({id: "register.validation.password"})),
    password_confirmation: yup.string().required(f({id: "register.validation.passwordConfirmation"}))
    .oneOf([yup.ref('password'), null], f({id: "register.validation.passwordConfirmation"}))
  }), [f]);
  // render
  const discovery = state.metadata.discovery;
  return (
    <Formik
        enableReinitialize={true}
        initialValues={{
          name: tmpClaims.name || "",
          email: tmpClaims.email || "",
          password: tmpCreds.password || "",
          password_confirmation: tmpCreds.password_confirmation || "",
        }}
        validationSchema={userSchema}
        onSubmit={(values, { setSubmitting, setFieldError }) => {
          setSubmitting(true);
          handlePayloadSubmit();
          setTimeout(() => {
            setSubmitting(false);
          }, 200);
        }}
      >
      {(formik: FormikProps<any>) => (
        <>
          <ScreenLayout
            title={f({id: "register.signUp"})}
            subtitle={f({id: "register.createAccount"})}
            loading={loading}
            error={errors.global && f({id: "register.validation.email.exist"})}
            buttons={[
              {
                status: "primary",
                children: f({id: "button.continue"}),
                onPress: formik.submitForm,
                loading: handlePayloadSubmitLoading,
                tabIndex: 55,
              },
              {
                size: "medium",
                group: [
                  {
                    children: f({id: "register.privacyPolicy"}),
                    onPress: () => window.open(discovery.op_policy_uri!, "_blank"),
                    disabled: !discovery.op_policy_uri,
                    tabIndex: 4,
                  },
                  {
                    children: f({id: "register.termsOfService"}),
                    onPress: () => window.open(discovery.op_tos_uri!, "_blank"),
                    disabled: !discovery.op_tos_uri,
                    tabIndex: 5,
                  },
                ],
              },
              {
                size: "medium",
                children: f({id: "button.cancel"}),
                onPress: () => {
                  handleCancel();
                  formik.resetForm();
                },
                loading: handleCancelLoading,
                hidden: !state.routes.login,
                tabIndex: 56,
              },
            ]}
          >
            <Form>
              <Field name="name">
                  {({
                    field,
                    meta: {
                      touched: fieldTouched, error,
                    },
                  }: FieldProps<string>) => (
                    <FormInput
                      label={payloadLabels.claims.name}
                      tabIndex={51}
                      keyboardType={"default"}
                      placeholder={f({id: "placeholder.name"})}
                      autoCompleteType={"name"}
                      autoFocus={!payload.name}
                      // {...field}
                      value={field.value}
                      setValue={v => {
                        formik.setFieldValue("name", v);
                        setPayload(p => ({...p, name: v}))
                      }}
                      error={(fieldTouched && error) || errors["claims.name"]}
                      style={{marginBottom: 15}}
                    />
                  )}
              </Field>
              <Field name="email">
                  {({
                    field,
                    meta: {
                      touched: fieldTouched, error,
                    },
                  }: FieldProps<string>) => (
                    <FormInput
                      label={payloadLabels.claims.email}
                      tabIndex={52}
                      keyboardType={"email-address"}
                      placeholder={f({id: "placeholder.email"})}
                      autoCompleteType={"username"}
                      // {...field}
                      value={field.value}
                      setValue={v => {
                        formik.setFieldValue("email", v);
                        setPayload(p => ({...p, email: v}));
                      }}
                      accessoryRight={emailVerified ? (evaProps) => <Icon {...evaProps} name={"checkmark-circle-2-outline"} /> : undefined}
                      error={(fieldTouched && error) || errors["claims.email"]}
                      // onEnter={handlePayloadSubmit}
                      style={{marginBottom: 15}}
                    />
                  )}
              </Field>
              <Field name="password">
                  {({
                    field,
                    meta: {
                      touched: fieldTouched, error,
                    },
                  }: FieldProps<string>) => (
                    <FormInput
                      label={payloadLabels.credentials.password}
                      tabIndex={53}
                      secureTextEntry
                      autoCompleteType={"password"}
                      placeholder={f({id: "placeholder.password"})}
                      // {...field}
                      value={field.value}
                      setValue={v => {
                        formik.setFieldValue("password", v);
                        setPayload(p => ({...p, password: v }));
                      }}
                      error={(fieldTouched && error) || errors["credentials.password"]}
                      // onEnter={handlePayloadSubmit}
                      style={{marginBottom: 15}}
                    />
                  )}
              </Field>
              <Field name="password_confirmation">
                  {({
                    field,
                    meta: {
                      touched: fieldTouched, error,
                    },
                  }: FieldProps<string>) => (
                    <FormInput
                      label={payloadLabels.credentials.password_confirmation}
                      tabIndex={54}
                      secureTextEntry
                      autoCompleteType={"password"}
                      placeholder={f({id: "placeholder.passwordConfirmation"})}
                      // {...field}
                      value={field.value}
                      setValue={v => {
                        formik.setFieldValue("password_confirmation", v);
                        setPayload(p => ({...p, password_confirmation: v }));
                      }}
                      error={(fieldTouched && error) || errors["credentials.password_confirmation"]}
                      // onEnter={handlePayloadSubmit}
                    />
                  )}
              </Field>
            </Form>
            <Text style={{marginTop: 30}}>
              {f({id: "register.continueThenAgreed"})}
            </Text>
          </ScreenLayout>
      </>
      )}
      </Formik>
  );
};
